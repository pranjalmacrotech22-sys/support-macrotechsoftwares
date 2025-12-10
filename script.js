// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const SUPABASE_URL = 'https://szcdeothrkojxktahwmi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Y2Rlb3RocmtvanhrdGFod21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MDgzMzcsImV4cCI6MjA4MDI4NDMzN30.3UyQjKfFHAKzl0SgwkMH8KKVy9MSUKXOU5Gfu874aMg';

// --- MODIFIED LINE: Explicitly enable session persistence ---
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true
    }
});

// SLA & Automation Rules
const SLA_POLICIES = {
    'High': 8,    // 8 hours
    'Medium': 24, // 24 hours
    'Low': 72     // 3 days
};
const AUTO_CLOSE_DAYS = 3; // Days after which 'Resolved' tickets become 'Closed'

// Global Variables
let currentIssueId = null;
let adminIssuesList = [];
let supportIssuesList = [];
let userIssuesList = [];
let allUsersCache = []; 
let statusChartInstance = null;
let priorityChartInstance = null;
let categoryChartInstance = null;
let trendChartInstance = null;
let resolutionChartInstance = null;
let finalImageFiles = []; 

// ==========================================
// 2. TOAST NOTIFICATION & UTILS
// ==========================================
const toastStyles = document.createElement('style');
toastStyles.innerHTML = `
    .custom-toast {
        position: fixed; top: 20px; right: 20px; background-color: #0f172a; color: #fff; padding: 16px 24px; border-radius: 8px; border-left: 5px solid #d4af37; box-shadow: 0 10px 30px rgba(0,0,0,0.15); font-family: 'Inter', sans-serif; font-size: 0.95rem; z-index: 10000; display: flex; align-items: center; gap: 12px; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); max-width: 350px;
    }
    .custom-toast.show { transform: translateX(0); }
    .custom-toast.error { border-left-color: #ef4444; }
    .toast-icon { font-size: 1.2rem; }
`;
document.head.appendChild(toastStyles);

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.add('show'); });
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3500);
}

// Date Formatting Function
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}


// ==========================================
// 3. AUTHENTICATION & ROUTING
// ==========================================
async function checkAuth(requiredRole) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    const { data: profile } = await supabase.from('users').select('*').eq('id', session.user.id).single();

    // Check for expiration date
    if (profile && profile.exp_date) {
        const expDate = new Date(profile.exp_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize today's date

        if (expDate < today) {
            if (profile.is_active) {
                await supabase.from('users').update({ is_active: false }).eq('id', session.user.id);
            }
            await supabase.auth.signOut();
            showToast("Your account has expired. Please contact an administrator.", "error");
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }
    }
    
    if (profile.is_active === false) {
        await supabase.auth.signOut();
        showToast("Account deactivated. Contact Admin.", "error");
        setTimeout(() => window.location.href = 'index.html', 2000);
        return;
    }

    if (requiredRole && profile.role !== requiredRole) {
        if (profile.role === 'admin') window.location.href = 'admin_dashboard.html';
        else if (profile.role === 'support') window.location.href = 'support_dashboard.html';
        else window.location.href = 'user_dashboard.html';
        return;
    }
    
    // --- POPULATE USER INFO BAR (if on user dashboard) ---
    const userInfoEmail = document.getElementById('user-info-email');
    if (userInfoEmail) {
        userInfoEmail.textContent = profile.email;
        document.getElementById('user-info-member-since').textContent = formatDate(profile.created_at);
        document.getElementById('user-info-expiry-date').textContent = formatDate(profile.exp_date);
    }

    document.body.style.visibility = 'visible';
    document.body.style.opacity = '1';
    
    if (requiredRole === 'support') {
        if (document.getElementById('user-name-display')) {
            document.getElementById('user-name-display').textContent = profile.name || profile.email;
        }
        if (document.getElementById('user-avatar-initial')) {
            document.getElementById('user-avatar-initial').textContent = (profile.name || profile.email).charAt(0).toUpperCase();
        }
    }

    setupRealtimeSubscriptions(session.user.id, profile.role);
    injectReopenedOptions();
}

function injectReopenedOptions() {
    const ids = ['filter-status', 'admin-status-select', 'support-status-select'];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (sel && !sel.querySelector('option[value="Reopened"]')) {
            const opt = document.createElement('option');
            opt.value = "Reopened";
            opt.innerText = "Reopened";
            sel.appendChild(opt);
        }
    });
}

function showForm(type) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    if (loginForm && signupForm) {
        loginForm.style.display = type === 'login' ? 'block' : 'none';
        signupForm.style.display = type === 'signup' ? 'block' : 'none';
        tabLogin.className = type === 'login' ? 'active' : '';
        tabSignup.className = type === 'signup' ? 'active' : '';
    }
}

const signupForm = document.getElementById('signup-form');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const name = document.getElementById('signup-name').value;
        const number = document.getElementById('signup-number').value;
        const org = document.getElementById('signup-org').value;
        
        if (number.length !== 10) {
            showToast("Mobile number must be 10 digits.", "error");
            return;
        }

        const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, number, organization: org } } });
        if (error) { showToast(error.message, "error"); } 
        else { showToast('Signup successful! Please log in.'); window.location.reload(); }
    });
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { showToast(error.message, "error"); return; }
        
        const { data: profile } = await supabase.from('users').select('role, is_active, exp_date').eq('id', data.user.id).single();

        if (profile && profile.exp_date) {
            const expDate = new Date(profile.exp_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (expDate < today) {
                if (profile.is_active) {
                    await supabase.from('users').update({ is_active: false }).eq('id', data.user.id);
                }
                await supabase.auth.signOut();
                showToast("Your account has expired. Please contact an administrator.", "error");
                return;
            }
        }

        if (profile.is_active === false) {
            await supabase.auth.signOut();
            showToast("Account deactivated. Contact Admin.", "error");
            return;
        }

        if (profile.role === 'admin') window.location.href = 'admin_dashboard.html';
        else if (profile.role === 'support') window.location.href = 'support_dashboard.html';
        else window.location.href = 'user_dashboard.html';
    });
}
async function logout() { await supabase.auth.signOut(); window.location.href = 'index.html'; }

// ==========================================
// 4. REAL-TIME & NOTIFICATIONS (ENHANCED)
// ==========================================
function setupRealtimeSubscriptions(userId, role) {
    loadNotifications(userId); // Initial load
    const channel = supabase.channel('app-realtime-changes');

    // --- Notifications ---
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, 
        (payload) => {
            const badge = document.getElementById('notif-badge');
            if (badge) {
                let count = parseInt(badge.innerText) || 0;
                badge.innerText = count + 1;
                badge.style.display = 'block';
            }
            loadNotifications(userId);
            showToast("New Notification: " + payload.new.message);
        }
    );

    // --- Issues (Tickets) ---
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'issues' },
        (payload) => {
            console.log('Issue change detected:', payload);
            if (role === 'admin') loadAllIssues();
            else if (role === 'support') loadSupportIssues();
            else if (role === 'user') loadUserIssues();
            if (currentIssueId && (payload.new?.id === currentIssueId || payload.old?.id === currentIssueId)) {
                if (payload.eventType === 'DELETE') {
                    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
                    document.body.style.overflow = ''; 
                    showToast('The ticket you were viewing was deleted.', 'error');
                }
            }
        }
    );

    // --- Comments (Chat) ---
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' },
        (payload) => {
            if (currentIssueId && payload.new.issue_id == currentIssueId) {
                let chatBoxId = 'chat-box';
                if (role === 'admin') chatBoxId = 'admin-chat-box';
                if (role === 'support') chatBoxId = 'support-chat-box';
                loadComments(currentIssueId, chatBoxId);
            }
        }
    );
    
    // --- Categories ---
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'categories' },
        (payload) => {
            console.log('Category change detected:', payload);
            if (role === 'admin') loadCategories();
            if (role === 'user') loadCategoriesForDropdown();
        }
    );

    // --- Users & Orgs (for Admin only) ---
    if (role === 'admin') {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: 'users' },
            (payload) => {
                console.log('User change detected:', payload);
                loadAllUsers(); 
                loadOrganizations();
            }
        );
    }
    
    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log('Real-time channel connected!');
        }
    });
}

function toggleNotifications() { document.getElementById('notif-dropdown').classList.toggle('show'); }
window.addEventListener('click', function(e) {
    const wrapper = document.querySelector('.notification-wrapper');
    const dropdown = document.getElementById('notif-dropdown');
    if (wrapper && dropdown && !wrapper.contains(e.target)) { dropdown.classList.remove('show'); }
});

async function loadNotifications(userId) {
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;
    if (!userId) { const { data: { user } } = await supabase.auth.getUser(); if(user) userId = user.id; else return; }
    const { data: notifs } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
    const unreadCount = notifs ? notifs.filter(n => !n.is_read).length : 0;
    if(badge) { badge.innerText = unreadCount; badge.style.display = unreadCount > 0 ? 'block' : 'none'; }
    list.innerHTML = notifs?.length ? notifs.map(n => `<div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markAsRead('${n.id}')" style="padding:10px; border-bottom:1px solid #f1f5f9; cursor:pointer; background:${n.is_read?'white':'#f0f9ff'};"><div style="font-size:0.85rem; color:#334155;">${n.message}</div><span style="font-size:0.7rem; color:#94a3b8;">${new Date(n.created_at).toLocaleTimeString()}</span></div>`).join('') : '<div style="padding:15px; text-align:center;">No notifications</div>';
}
async function markAsRead(id) { await supabase.from('notifications').update({ is_read: true }).eq('id', id); const { data: { user } } = await supabase.auth.getUser(); loadNotifications(user.id); }
async function sendNotification(recipientId, message) { if (!recipientId) return; await supabase.from('notifications').insert({ user_id: recipientId, message }); }

// ==========================================
// 5. VOICE TO ISSUE & FILE UPLOAD
// ==========================================
function initVoiceToIssue() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceBtn = document.getElementById('voice-to-text-btn');
    const voiceStatus = document.getElementById('voice-status-text');
    const descTextarea = document.getElementById('issue-desc');

    if (!SpeechRecognition || !voiceBtn || !voiceStatus || !descTextarea) {
        if (voiceBtn) voiceBtn.style.display = 'none';
        return;
    }

    const recognizer = new SpeechRecognition();
    recognizer.continuous = false;
    recognizer.interimResults = false;
    recognizer.lang = 'en-US';

    voiceBtn.addEventListener('click', () => {
        try {
            recognizer.start();
            voiceStatus.textContent = 'Listening...';
            voiceBtn.style.borderColor = '#d4af37';
            voiceBtn.disabled = true;
        } catch (e) {
            console.error("Speech recognition could not be started: ", e);
            showToast('Voice recognition is busy.', 'error');
        }
    });

    recognizer.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const currentText = descTextarea.value.trim();
        descTextarea.value = currentText + (currentText.length > 0 ? ' ' : '') + transcript + '.';
        showToast('Voice input captured!', 'success');
    };

    recognizer.onerror = (event) => {
        let errorMessage = 'An error occurred during recognition.';
        if (event.error === 'no-speech') {
            errorMessage = "No speech was detected. Please try again.";
        } else if (event.error === 'audio-capture') {
            errorMessage = "Microphone not found. Ensure it is enabled.";
        } else if (event.error === 'not-allowed') {
            errorMessage = "Permission to use microphone was denied.";
        }
        showToast(errorMessage, 'error');
    };

    recognizer.onend = () => {
        voiceStatus.textContent = 'Use Mic';
        voiceBtn.style.borderColor = '#cbd5e1';
        voiceBtn.disabled = false;
    };
}


function initFileUpload() {
    const dropZone = document.getElementById('drop-zone');
    const input = document.getElementById('issue-images-input');
    if(!dropZone || !input) return;

    dropZone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, (evt) => { evt.preventDefault(); evt.stopPropagation(); }, false));
    dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

    document.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const files = [];
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file') files.push(item.getAsFile());
        }
        if (files.length > 0) { handleFiles(files); showToast("Image pasted!"); }
    });
}

function handleFiles(files) {
    for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) finalImageFiles.push(files[i]);
    }
    updateImagePreviews();
}

function updateImagePreviews() {
    const container = document.getElementById('image-previews');
    container.innerHTML = '';
    finalImageFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        const btn = document.createElement('button');
        btn.className = 'remove-img-btn';
        btn.innerHTML = '&times;';
        btn.onclick = (e) => { e.stopPropagation(); removeFile(index); };
        div.appendChild(img); div.appendChild(btn); container.appendChild(div);
    });
}

function removeFile(index) { finalImageFiles.splice(index, 1); updateImagePreviews(); }

async function loadCategoriesForDropdown() {
    const container = document.getElementById('category-chips-container');
    if(!container) return;
    const { data } = await supabase.from('categories').select('*').order('name');
    if(data) {
        container.innerHTML = ''; 
        data.forEach(c => {
            const chip = document.createElement('div');
            chip.className = 'category-chip';
            chip.innerText = c.name;
            chip.onclick = () => selectCategory(c.id, chip);
            container.appendChild(chip);
        });
    }
}

function selectCategory(id, chipElement) {
    document.getElementById('issue-category').value = id;
    const allChips = document.querySelectorAll('.category-chip');
    allChips.forEach(c => c.classList.remove('active'));
    chipElement.classList.add('active');
}

// ==========================================
// 6. ISSUE MANAGEMENT
// ==========================================
async function createIssue(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button'); 
    const categoryId = document.getElementById('issue-category').value;
    if (!categoryId) { showToast("Please select a category.", "error"); return; }

    btn.innerText = 'Submitting...'; btn.disabled = true;
    try {
        const title = document.getElementById('issue-title').value;
        const description = document.getElementById('issue-desc').value;
        const priority = document.getElementById('issue-priority').value;
        const { data: { user } } = await supabase.auth.getUser();
        
        let imageUrls = [];
        if (finalImageFiles.length > 0) {
            for (const file of finalImageFiles) {
                const name = `${Date.now()}-${file.name.replace(/\s/g, '_')}`;
                await supabase.storage.from('issue-images').upload(name, file);
                const { data } = supabase.storage.from('issue-images').getPublicUrl(name);
                imageUrls.push(data.publicUrl);
            }
        }
        
        const payload = { user_id: user.id, title, description, priority, category_id: categoryId, images: imageUrls };
        const { error } = await supabase.from('issues').insert(payload);
        if (error) throw error;
        
        showToast('Ticket Submitted Successfully!'); 
        e.target.reset();
        document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
        document.getElementById('issue-category').value = "";
        finalImageFiles = []; updateImagePreviews();
    } catch (err) { showToast(err.message, "error"); } finally { btn.innerText = 'Submit Ticket'; btn.disabled = false; }
}

async function loadUserIssues() {
    const { data: { user } } = await supabase.auth.getUser();
    const list = document.getElementById('issues-list');
    const search = document.getElementById('search-input')?.value || '';
    const filter = document.getElementById('filter-status')?.value || 'All';
    if(!list) return;

    let query = supabase.from('issues').select('*, categories(name)').eq('user_id', user.id).order('created_at', {ascending:false});
    if (search) query = query.ilike('title', `%${search}%`);
    if (filter !== 'All') query = query.eq('status', filter);

    const { data: issues, error } = await query;
    userIssuesList = issues || [];

    // --- POPULATE TOTAL TICKETS IN INFO BAR ---
    const totalTicketsEl = document.getElementById('user-info-total-tickets');
    if (totalTicketsEl) {
        totalTicketsEl.textContent = userIssuesList.length;
    }

    if (error) { list.innerHTML = `<p style="color:red; text-align:center;">Error: ${error.message}</p>`; return; }
    if (userIssuesList.length === 0) { list.innerHTML = `<div style="text-align:center; padding:30px; color:#94a3b8;"><p style="font-size:1.5rem; margin-bottom:5px;">📭</p>No issues found matching criteria.</div>`; return; }

    list.innerHTML = issues.map(i => {
        let statusClass = 'status-open';
        if(i.status === 'In Progress') statusClass = 'status-progress';
        if(i.status === 'Resolved') statusClass = 'status-resolved';
        if(i.status === 'Closed') statusClass = 'status-closed';
        if(i.status === 'Reopened') statusClass = 'status-open'; 
        let prioClass = 'p-low';
        if(i.priority === 'High') prioClass = 'p-high';
        if(i.priority === 'Medium') prioClass = 'p-medium';
        const catName = i.categories?.name || 'General';

        return `<div class="issue-card-item" data-status="${i.status}">
            <div class="card-header-row"><h5 class="card-title">${i.title}</h5><span class="status-badge ${statusClass}">${i.status}</span></div>
            <div class="card-meta-row"><span class="meta-pill">${catName}</span><span>&bull;</span><span>#${i.id}</span><span>&bull;</span><span>${formatDate(i.created_at)}</span></div>
            <div class="card-footer-row"><div class="priority-indicator ${prioClass}"><span>●</span> ${i.priority} Priority</div><button onclick="openUserIssueDetail('${i.id}')" class="btn-view-outline">View Details</button></div>
        </div>`;
    }).join('');
}

// ==========================================
// 7. MODALS & UI INTERACTIONS
// ==========================================

function switchAdminTab(tabName) {
    document.querySelectorAll('.tab-section').forEach(section => { section.style.display = 'none'; });
    document.getElementById('tab-' + tabName).style.display = 'block';
    document.querySelectorAll('.nav-link').forEach(btn => { btn.classList.remove('active'); });
    document.getElementById('link-' + tabName).classList.add('active');
    if (window.innerWidth <= 900) { toggleSidebar(); }
}

async function openUserIssueDetail(issueId) {
    currentIssueId = issueId;
    const { data: issue } = await supabase.from('issues').select('*, categories(name)').eq('id', issueId).single();
    document.getElementById('detail-title').innerText = issue.title;
    document.getElementById('detail-id').innerText = issue.id;
    document.getElementById('detail-desc').value = issue.description;
    let assignedText = "Unassigned";
    if (issue.assigned_to) { const { data: staff } = await supabase.from('users').select('name, email').eq('id', issue.assigned_to).single(); if(staff) assignedText = staff.name || staff.email; }
    document.getElementById('detail-assigned').innerText = assignedText;
    document.getElementById('detail-images').innerHTML = issue.images?.map(url => `<a href="${url}" target="_blank"><img src="${url}" class="attachment-thumb"></a>`).join('') || '<small style="color:#94a3b8; font-size:0.8rem;">No images</small>';
    const catDiv = document.getElementById('detail-category');
    if(catDiv) catDiv.innerText = issue.categories?.name || 'General';
    updateTimelineVisual(issue.status, 'step-');
    
    const btnEdit = document.getElementById('btn-edit'), btnSave = document.getElementById('btn-save-edit'), btnResolve = document.getElementById('btn-resolve'), btnReopen = document.getElementById('btn-reopen');
    document.getElementById('detail-desc').disabled = true; btnEdit.style.display = 'none'; btnSave.style.display = 'none'; btnResolve.style.display = 'none'; btnReopen.style.display = 'none';
    if (['Open', 'Reopened'].includes(issue.status)) btnEdit.style.display = 'block';
    if (['Open', 'In Progress', 'Reopened'].includes(issue.status)) btnResolve.style.display = 'block';
    if (['Closed', 'Resolved'].includes(issue.status)) btnReopen.style.display = 'block';
    
    loadComments(issueId, 'chat-box');
    document.body.style.overflow = 'hidden';
    document.getElementById('user-issue-modal').style.display = 'block';
}

function closeUserModal() { 
    currentIssueId = null; 
    document.getElementById('user-issue-modal').style.display = 'none';
    document.body.style.overflow = '';
}

function enableEditMode() { document.getElementById('detail-desc').disabled = false; document.getElementById('btn-edit').style.display = 'none'; document.getElementById('btn-save-edit').style.display = 'block'; }
async function saveIssueEdit() { const d = document.getElementById('detail-desc').value; await supabase.from('issues').update({ description: d }).eq('id', currentIssueId); showToast('Updated'); closeUserModal(); }

async function changeIssueStatus(newStatus) {
    if (newStatus === 'Open') newStatus = 'Reopened';
    if(!confirm(`Mark as ${newStatus}?`)) return;
    
    const updates = { status: newStatus };
    if (newStatus === 'Resolved' || newStatus === 'Closed') {
        updates.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase.from('issues').update(updates).eq('id', currentIssueId);
    if (error) { showToast('Failed: ' + error.message, 'error'); return; }
    
    if (newStatus === 'Reopened') {
        const { data: issue } = await supabase.from('issues').select('title, assigned_to').eq('id', currentIssueId).single();
        const msg = `Ticket #${currentIssueId} REOPENED by user.`;
        if (issue.assigned_to) await sendNotification(issue.assigned_to, msg);
        const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
        if (admins) admins.forEach(a => sendNotification(a.id, msg));
    }
    showToast('Status Updated'); closeUserModal();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    if (window.innerWidth <= 900) { sidebar.classList.toggle('open'); } 
    else { sidebar.classList.toggle('collapsed'); mainContent.classList.toggle('expanded'); }
}

// --- SLA & AUTOMATION ---
function getSlaStatus(issue) {
    if (issue.status === 'Closed' || issue.status === 'Resolved') {
        return { text: 'Met', cssClass: 'sla-met', tooltip: 'This ticket is resolved or closed.' };
    }
    const slaHours = SLA_POLICIES[issue.priority];
    if (!slaHours) {
        return { text: 'On Track', cssClass: 'sla-on-track', tooltip: 'No SLA policy for this priority.' };
    }
    const createdAt = new Date(issue.created_at);
    const deadline = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);
    const now = new Date();
    const timeLeftMs = deadline - now;
    if (timeLeftMs < 0) {
        return { text: 'Breached', cssClass: 'sla-breached', tooltip: `SLA was due ${Math.abs(Math.round(timeLeftMs / (1000 * 60 * 60)))} hours ago.` };
    }
    const totalTimeMs = slaHours * 60 * 60 * 1000;
    if (timeLeftMs < totalTimeMs * 0.25) {
        return { text: 'At Risk', cssClass: 'sla-at-risk', tooltip: `SLA due in under ${Math.round(timeLeftMs / (1000 * 60 * 60))} hours.` };
    }
    return { text: 'On Track', cssClass: 'sla-on-track', tooltip: `SLA due in ${Math.round(timeLeftMs / (1000 * 60 * 60))} hours.` };
}

async function runAutomations() {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - AUTO_CLOSE_DAYS);
    const { data: ticketsToClose, error } = await supabase
        .from('issues')
        .select('id')
        .eq('status', 'Resolved')
        .lt('resolved_at', thresholdDate.toISOString());

    if (error || !ticketsToClose || ticketsToClose.length === 0) return;
    const idsToClose = ticketsToClose.map(t => t.id);
    const { error: updateError } = await supabase.from('issues').update({ status: 'Closed' }).in('id', idsToClose);
    if (!updateError) showToast(`Auto-closed ${idsToClose.length} resolved ticket(s).`);
}


// --- ADMIN ---
function applyAdminFilters() {
    const selectedStatuses = Array.from(document.querySelectorAll('.filter-status:checked')).map(cb => cb.value);
    const selectedPriorities = Array.from(document.querySelectorAll('.filter-priority:checked')).map(cb => cb.value);
    const startDate = document.getElementById('filter-date-start').value;
    const endDate = document.getElementById('filter-date-end').value;

    const filteredIssues = adminIssuesList.filter(issue => {
        let matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(issue.status);
        let matchesPriority = selectedPriorities.length === 0 || selectedPriorities.includes(issue.priority);
        let matchesDate = true;
        if (startDate && endDate) {
            const issueDate = new Date(issue.created_at).setHours(0,0,0,0);
            const start = new Date(startDate).setHours(0,0,0,0);
            const end = new Date(endDate).setHours(23,59,59,999);
            matchesDate = issueDate >= start && issueDate <= end;
        }
        return matchesStatus && matchesPriority && matchesDate;
    });
    renderAdminIssueTable(filteredIssues);
}

function clearAdminFilters() {
    document.querySelectorAll('.filter-status, .filter-priority').forEach(cb => cb.checked = false);
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    renderAdminIssueTable(adminIssuesList);
}

function renderAdminIssueTable(issues) {
    const tbody = document.querySelector('#issues-table tbody');
    if (!tbody) return;
    if (issues.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#94a3b8;">No matching tickets found.</td></tr>`; return; }
    tbody.innerHTML = issues.map(issue => {
        let assignedName = '<span style="color:#94a3b8;">Unassigned</span>';
        if(issue.assignee) assignedName = `<span style="font-weight:500; color:var(--navy-dark);">${issue.assignee.name || issue.assignee.email}</span>`;
        let statusClass = 'status-open';
        if(issue.status === 'In Progress') statusClass = 'status-progress';
        if(issue.status === 'Resolved') statusClass = 'status-resolved';
        if(issue.status === 'Closed') statusClass = 'status-closed';
        if(issue.status === 'Reopened') statusClass = 'status-open';
        const catName = issue.categories?.name || 'General';
        const reporterData = issue.reporter; 
        const orgText = reporterData?.organization ? `<span style="display:block; font-size:0.7rem; color:#d4af37; margin-top:2px;">${reporterData.organization}</span>` : '';
        const dateStr = formatDate(issue.created_at);
        const sla = getSlaStatus(issue);

        return `<tr>
            <td style="color:#64748b; font-size:0.85rem; white-space:nowrap;">${dateStr}</td>
            <td><div style="font-weight:600; color:var(--navy-dark);">${issue.title}</div><div style="font-size:0.8rem; color:#64748b; margin-top:4px;">${catName}</div></td>
            <td><div class="user-info"><span style="font-weight:500;">${reporterData?.name || 'Unknown'}</span><span class="user-email">${reporterData?.email || ''}</span>${orgText}</div></td>
            <td><strong style="font-size:0.8rem;">${issue.priority}</strong></td>
            <td><div class="sla-indicator ${sla.cssClass}" title="${sla.tooltip}"><span class="sla-indicator-dot"></span> ${sla.text}</div></td>
            <td>${assignedName}</td>
            <td><span class="status-badge ${statusClass}">${issue.status}</span></td>
            <td><button onclick="openAdminIssueDetailById('${issue.id}')" class="btn-action">Details</button></td>
        </tr>`;
    }).join('');
}


async function loadAllIssues() {
    await runAutomations(); // Run automations before loading data
    const { data: issues, error } = await supabase
        .from('issues')
        .select('*, categories(name), reporter:users!issues_user_id_fkey(name, email, organization), assignee:users!issues_assigned_to_fkey(name, email)')
        .order('created_at', { ascending: false });
        
    if (error) { document.querySelector('#issues-table tbody').innerHTML = `<tr><td colspan="7">Error loading data</td></tr>`; return; }
    adminIssuesList = issues || [];
    if (typeof renderCharts === 'function') renderCharts(adminIssuesList);
    renderAdminIssueTable(adminIssuesList);
}

function openAdminIssueDetailById(id) {
    const issue = adminIssuesList.find(i => i.id == id);
    if (!issue) return;
    currentIssueId = issue.id;
    document.getElementById('admin-detail-title').innerText = issue.title;
    document.getElementById('admin-detail-id').innerText = issue.id;
    document.getElementById('admin-detail-desc').innerText = issue.description;
    document.getElementById('admin-assign-select').value = issue.assigned_to || "";
    document.getElementById('admin-status-select').value = issue.status;
    const reporterData = issue.reporter || issue.users;
    const orgHtml = reporterData?.organization ? `<br><small style="color:#d4af37;">${reporterData.organization}</small>` : '';
    document.getElementById('admin-detail-user').innerHTML = `${reporterData?.name || reporterData?.email} ${orgHtml}`;
    document.getElementById('admin-priority-select').value = issue.priority || "Low";
    document.getElementById('admin-internal-note').value = issue.internal_note || "";
    document.getElementById('admin-detail-images').innerHTML = issue.images?.map(url => `<a href="${url}" target="_blank"><img src="${url}" class="attachment-thumb"></a>`).join('') || '<small style="color:#94a3b8; font-size:0.8rem;">No images</small>';
    updateTimelineVisual(issue.status, 'admin-step-');
    loadComments(issue.id, 'admin-chat-box');
    document.body.style.overflow = 'hidden';
    document.getElementById('admin-issue-modal').style.display = 'block';
}

function closeAdminModal() { 
    currentIssueId = null; 
    document.getElementById('admin-issue-modal').style.display = 'none';
    document.body.style.overflow = '';
}

async function adminAssignIssue() { 
    const staffId = document.getElementById('admin-assign-select').value || null;
    const priority = document.getElementById('admin-priority-select').value;
    const note = document.getElementById('admin-internal-note').value;
    const { error } = await supabase.from('issues').update({ assigned_to: staffId, priority: priority, internal_note: note }).eq('id', currentIssueId);
    
    if (error) {
        showToast('Assignment failed: ' + error.message, 'error');
        return;
    }

    if(staffId) {
        let msg = `Assigned Ticket #${currentIssueId} (Priority: ${priority})`;
        if(note) msg += ". Check notes.";
        await sendNotification(staffId, msg);
    }
    showToast('Assignment Updated'); 
    closeAdminModal();
}

async function adminUpdateStatus() {
    const s = document.getElementById('admin-status-select').value;
    const updates = { status: s };
    if (s === 'Resolved' || s === 'Closed') {
        updates.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase.from('issues').update(updates).eq('id', currentIssueId);

    if (error) {
        showToast('Update failed: ' + error.message, 'error');
        return;
    }

    showToast('Status Updated');
    closeAdminModal();
}

async function deleteIssue(id) { 
    if(confirm('Delete ticket?')) { 
        await supabase.from('issues').delete().eq('id', id); 
        closeAdminModal(); 
        showToast('Ticket Deleted'); 
    } 
}

// REFACTORED to use a render function
async function loadAllUsers() {
    const { data: users } = await supabase.from('users').select('*').order('created_at');
    allUsersCache = users || [];
    renderAdminUserTable(allUsersCache);
    // Reset filter buttons to 'All'
    document.querySelectorAll('.role-filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('filter-role-all').classList.add('active');
}

// NEW FUNCTION for filtering
function filterUsersByRole(role) {
    // Update active button
    document.querySelectorAll('.role-filter-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`filter-role-${role}`).classList.add('active');

    if (role === 'all') {
        renderAdminUserTable(allUsersCache);
        return;
    }

    const filteredUsers = allUsersCache.filter(user => user.role === role);
    renderAdminUserTable(filteredUsers);
}

// NEW RENDER FUNCTION (extracted from loadAllUsers)
function renderAdminUserTable(users) {
    const tbody = document.querySelector('#users-table tbody');
    if(!tbody) return;

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No users found for this filter.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = users.map(u => {
        const isActive = u.is_active !== false;
        const statusColor = isActive ? '#10b981' : '#ef4444';
        const statusText = isActive ? 'Active' : 'Inactive';
        const btnText = isActive ? 'Deactivate' : 'Activate';
        const btnColor = isActive ? '#ef4444' : '#10b981';
        const orgDisplay = u.organization ? `<div style="font-size:0.75rem; color:#d4af37; margin-top:2px;">${u.organization}</div>` : '';
        const phoneDisplay = u.number ? `<div class="user-phone">${u.number}</div>` : '';
        const expDateValue = u.exp_date ? new Date(u.exp_date).toISOString().split('T')[0] : '';
        const isExpired = u.exp_date && new Date(u.exp_date) < new Date();

        return `<tr>
            <td><div class="user-info"><span style="font-weight:600;">${u.name||'No Name'}</span><span class="user-email">${u.email}</span>${phoneDisplay}${orgDisplay}</div></td>
            <td><select onchange="updateUserRole('${u.id}', this.value)" style="padding:6px; font-size:0.8rem; border-radius:4px; border:1px solid #cbd5e1; margin-bottom:0; background:#f8fafc; width:auto; cursor:pointer;"><option value="user" ${u.role==='user'?'selected':''}>User</option><option value="support" ${u.role==='support'?'selected':''}>Support</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></td>
            <td><input type="date" value="${expDateValue}" onblur="adminUpdateUserExpiry('${u.id}', this.value)" style="border: 1px solid ${isExpired ? 'var(--danger)' : '#cbd5e1'}; padding: 4px 8px; font-size: 0.85rem; border-radius: 4px; width: 150px;"></td>
            <td><span style="color:${statusColor}; font-weight:600; font-size:0.8rem;">${statusText}</span></td>
            <td><div style="display:flex; gap:5px;"><button onclick="toggleUserStatus('${u.id}', ${isActive})" class="btn-action" style="background:${btnColor}; font-size:0.7rem; padding:4px 8px;">${btnText}</button><button onclick="viewUserHistory('${u.id}', '${u.email}')" class="btn-action" style="background:#3b82f6; font-size:0.7rem; padding:4px 8px;">History</button></div></td>
        </tr>`;
    }).join('');
}


// MODIFIED to use onblur and remove confirmation
async function adminUpdateUserExpiry(userId, newDate) {
    if (!newDate) {
        showToast('Expiration date cannot be empty.', 'error');
        loadAllUsers(); // Reload to revert the visual change
        return;
    }
    
    const { error } = await supabase
        .from('users')
        .update({ exp_date: newDate })
        .eq('id', userId);

    if (error) {
        showToast(`Error updating date: ${error.message}`, 'error');
    } else {
        showToast('User expiration date updated successfully!', 'success');
    }
    // No need to reload all users if the visual change is accepted on blur
}


// ADMIN CREATE USER
function openCreateUserModal() {
    const expDateInput = document.getElementById('new-user-exp-date');
    if (expDateInput) {
        const today = new Date();
        today.setFullYear(today.getFullYear() + 1);
        expDateInput.value = today.toISOString().split('T')[0];
    }
    document.getElementById('create-user-modal').style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

function closeCreateUserModal() {
    document.getElementById('create-user-modal').style.display = 'none';
    document.getElementById('create-user-form').reset();
    document.body.style.overflow = ''; // Restore background scroll
}

async function adminCreateUser() {
    const name = document.getElementById('new-user-name').value;
    const email = document.getElementById('new-user-email').value;
    const password = document.getElementById('new-user-password').value;
    const number = document.getElementById('new-user-number').value;
    const org = document.getElementById('new-user-org').value;
    const role = document.getElementById('new-user-role').value;
    const exp_date = document.getElementById('new-user-exp-date').value;

    if (!name || !email || !password || !exp_date) {
        showToast("Name, Email, Password, and Expiration Date are required.", "error");
        return;
    }
    
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { name, number, organization: org, exp_date }
    });

    if (authError) {
        showToast(`Error creating user: ${authError.message}`, "error");
        return;
    }

    const { error: profileError } = await supabase.from('users').insert({
        id: authData.user.id, name, email, number, organization: org, role, exp_date
    });

    if (profileError) {
        showToast(`Auth user created, but profile failed: ${profileError.message}`, "error");
    } else {
        showToast("User created successfully!", "success");
        closeCreateUserModal();
        loadAllUsers();
    }
}


async function loadOrganizations() {
    if(!allUsersCache.length) { const { data: users } = await supabase.from('users').select('*'); allUsersCache = users || []; }
    const orgMap = {};
    allUsersCache.forEach(u => { const org = u.organization ? u.organization.trim() : 'Unassigned (No Org)'; if (!orgMap[org]) orgMap[org] = []; orgMap[org].push(u); });
    const tbody = document.querySelector('#org-table tbody');
    if (!tbody) return;
    if (Object.keys(orgMap).length === 0) { tbody.innerHTML = '<tr><td colspan="3">No organizations found.</td></tr>'; return; }
    tbody.innerHTML = Object.keys(orgMap).sort().map(org => {
        const count = orgMap[org].length;
        const safeOrg = org.replace(/'/g, "\\'");
        return `<tr><td style="font-weight:600; color:var(--navy-dark); font-size:0.95rem;">${org}</td><td><span style="background:#f1f5f9; padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:600; border:1px solid #e2e8f0; color:#334155;">${count} Users</span></td><td style="text-align: right;"><button onclick="openOrgDetail('${safeOrg}')" class="btn-action" style="background:var(--navy-light); color:white;">View Users</button></td></tr>`;
    }).join('');
}

function openOrgDetail(orgName) {
    document.getElementById('org-modal-title').innerText = orgName;
    const tbody = document.querySelector('#org-users-table tbody');
    tbody.innerHTML = ''; 
    const users = allUsersCache.filter(u => { const uOrg = u.organization ? u.organization.trim() : 'Unassigned (No Org)'; return uOrg === orgName; });
    users.forEach(u => {
        const isActive = u.is_active !== false; 
        const statusColor = isActive ? '#10b981' : '#ef4444';
        const statusText = isActive ? 'Active' : 'Inactive';
        const row = `<tr><td style="font-weight:600;">${u.name || 'No Name'}</td><td style="color:#64748b; font-size:0.85rem;">${u.email}</td><td style="text-transform:uppercase; font-size:0.75rem; font-weight:700;">${u.role}</td><td style="color:${statusColor}; font-size:0.8rem; font-weight:600;">${statusText}</td></tr>`;
        tbody.innerHTML += row;
    });
    document.body.style.overflow = 'hidden';
    document.getElementById('org-detail-modal').style.display = 'block';
}

function closeGenericModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.body.style.overflow = '';
}

async function updateUserRole(id, newRole) { if(confirm(`Change role to ${newRole.toUpperCase()}?`)) { const { error } = await supabase.from('users').update({role: newRole}).eq('id', id); if(error) { showToast('Error: ' + error.message, 'error'); } } } 
async function toggleUserStatus(id, currentStatus) { const newStatus = !currentStatus; if(confirm(`${newStatus ? 'Activate' : 'Deactivate'} this user account?`)) { await supabase.from('users').update({ is_active: newStatus }).eq('id', id); } } 
async function viewUserHistory(userId, userEmail) {
    document.getElementById('history-user-email').innerText = userEmail;
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
    document.body.style.overflow = 'hidden';
    document.getElementById('user-history-modal').style.display = 'block';
    const { data: issues } = await supabase.from('issues').select('*, categories(name)').eq('user_id', userId).order('created_at', {ascending:false});
    if(!issues || issues.length === 0) { tbody.innerHTML = '<tr><td colspan="3">No history found.</td></tr>'; } else { tbody.innerHTML = issues.map(i => `<tr><td>${formatDate(i.created_at)}</td><td><div style="font-weight:600;">${i.title}</div><small style="color:#64748b;">${i.categories?.name || 'General'}</small></td><td><span class="status-badge status-${i.status.toLowerCase().replace(' ','')}">${i.status}</span></td></tr>`).join(''); }
}
async function loadSupportStaffForDropdown() { const s = document.getElementById('admin-assign-select'); if(!s) return; const { data } = await supabase.from('users').select('*').eq('role','support'); s.innerHTML = '<option value="">-- Unassigned --</option>' + data.map(u=>`<option value="${u.id}">${u.name||u.email}</option>`).join(''); }
async function loadCategories() { 
    const tbody = document.querySelector('#categories-table tbody'); 
    if(!tbody) return; 
    const { data } = await supabase.from('categories').select('id, name').order('name'); 
    tbody.innerHTML = data.map(c => {
        const safeCategoryName = c.name.replace(/'/g, "\\'");
        return `<tr><td style="font-weight:500; cursor:pointer;" onclick="viewCategoryIssues(${c.id}, '${safeCategoryName}')">${c.name}</td><td style="text-align:right;"><button onclick="deleteCategory('${c.id}')" class="btn-action" style="background:#ef4444; color:white;">Delete</button></td></tr>`;
    }).join(''); 
}
async function addCategory() { const input = document.getElementById('new-category-input'); const name = input.value.trim(); if(!name) return; const { error } = await supabase.from('categories').insert({ name }); if(error) showToast(error.message, 'error'); else { input.value = ''; showToast('Category Added'); } } // Realtime handles the UI update
async function deleteCategory(id) { if(confirm('Delete category?')) { await supabase.from('categories').delete().eq('id', id); showToast('Category Deleted'); } } // Realtime handles the UI update

// UPDATED: VIEW CATEGORY ISSUES FUNCTION
async function viewCategoryIssues(categoryId, categoryName) {
    switchAdminTab('issues');
    clearAdminFilters();

    const tbody = document.querySelector('#issues-table tbody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px;">Loading tickets for ${categoryName}...</td></tr>`;
    }

    const { data: issues, error } = await supabase
        .from('issues')
        .select('*, categories(name), reporter:users!issues_user_id_fkey(name, email, organization), assignee:users!issues_assigned_to_fkey(name, email)')
        .eq('category_id', categoryId)
        .order('created_at', { ascending: false });

    if (error) {
        showToast('Error fetching category issues: ' + error.message, 'error');
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">Error loading data.</td></tr>`;
        return;
    }

    renderAdminIssueTable(issues);
    showToast(`Showing ${issues.length} tickets for category: ${categoryName}`);
}


// --- CHART CLICK HANDLER ---
function filterIssuesFromChart(filterType, filterValue) {
    clearAdminFilters();
    let filteredIssues = [];

    switch (filterType) {
        case 'status':
            filteredIssues = adminIssuesList.filter(issue => issue.status === filterValue);
            break;
        case 'priority':
            filteredIssues = adminIssuesList.filter(issue => issue.priority === filterValue);
            break;
        case 'category':
            filteredIssues = adminIssuesList.filter(issue => (issue.categories?.name || 'Uncategorized') === filterValue);
            break;
        case 'month':
            filteredIssues = adminIssuesList.filter(issue => new Date(issue.created_at).toLocaleString('default', { month: 'short' }) === filterValue);
            break;
        case 'assignee':
            filteredIssues = adminIssuesList.filter(issue => (issue.assignee?.name || issue.assignee?.email) === filterValue);
            break;
        default:
            return;
    }

    switchAdminTab('issues');
    renderAdminIssueTable(filteredIssues);
    showToast(`Showing ${filteredIssues.length} issues for: ${filterValue}`);
}

// --- CHURN ANALYSIS ---
function renderChurnAnalysis(issues) {
    const catList = document.getElementById('churn-categories-list');
    const clusterList = document.getElementById('churn-title-clusters');
    if (!catList || !clusterList) return;

    // 1. Category Analysis
    const categoryCounts = {};
    issues.forEach(i => {
        const catName = i.categories?.name || 'Uncategorized';
        categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;
    });
    const topCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    catList.innerHTML = topCategories.length ? topCategories.map(([name, count]) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.9rem;">
            <span style="font-weight: 500; color: #334155;">${name}</span>
            <span style="background: #e2e8f0; color: #334155; font-weight: 700; font-size: 0.75rem; padding: 4px 10px; border-radius: 12px;">${count} tickets</span>
        </div>
    `).join('') : '<p style="color:#94a3b8; font-size:0.85rem;">No category data to analyze.</p>';

    // 2. Title Clustering Analysis
    const titleClusters = {};
    issues.forEach(i => {
        const key = i.title.toLowerCase().trim().split(' ').slice(0, 3).join(' ');
        if (!titleClusters[key]) titleClusters[key] = [];
        titleClusters[key].push(i);
    });
    const topClusters = Object.entries(titleClusters)
        .filter(([key, cluster]) => cluster.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);
    
    clusterList.innerHTML = topClusters.length ? topClusters.map(([key, cluster]) => {
        const safeKey = key.replace(/'/g, "\\'");
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.9rem;">
                <span style="font-weight: 500; color: #334155; text-transform: capitalize;">"${key}..."</span>
                <div>
                    <span style="background: #e2e8f0; color: #334155; font-weight: 700; font-size: 0.75rem; padding: 4px 10px; border-radius: 12px; margin-right: 10px;">${cluster.length} tickets</span>
                    <button onclick="viewChurnCluster('${safeKey}')" class="btn-action" style="background: var(--navy-light); font-size: 0.7rem; padding: 4px 10px;">View</button>
                </div>
            </div>
        `
    }).join('') : '<p style="color:#94a3b8; font-size:0.85rem;">No significant recurring title patterns found.</p>';
}

function viewChurnCluster(searchKey) {
    switchAdminTab('issues');
    // We need to filter based on this new search term
    const filteredIssues = adminIssuesList.filter(issue => 
        issue.title.toLowerCase().startsWith(searchKey.toLowerCase())
    );
    renderAdminIssueTable(filteredIssues);
    showToast(`Showing issues related to "${searchKey}"`);
}

// --- HEATMAP RENDERING ---
function renderHeatmap(issues) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    const heatmapData = {};
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const resolvedIssues = issues.filter(i => (i.status === 'Resolved' || i.status === 'Closed') && i.assignee && i.resolved_at);

    resolvedIssues.forEach(issue => {
        const staffName = issue.assignee.name || issue.assignee.email;
        if (!heatmapData[staffName]) {
            heatmapData[staffName] = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        }
        const resolvedDate = new Date(issue.resolved_at);
        const dayOfWeek = days[resolvedDate.getDay()];
        heatmapData[staffName][dayOfWeek]++;
    });

    if (Object.keys(heatmapData).length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#94a3b8;">No resolved ticket data available to generate a heatmap.</p>';
        return;
    }

    let maxVal = 0;
    for (const staff in heatmapData) {
        for (const day in heatmapData[staff]) {
            if (heatmapData[staff][day] > maxVal) {
                maxVal = heatmapData[staff][day];
            }
        }
    }

    const getColorForValue = (value) => {
        if (value === 0) return '#f7fafc';
        if (maxVal === 0) return '#edf8e9';
        const percentage = value / maxVal;
        if (percentage > 0.8) return '#006d2c';
        if (percentage > 0.6) return '#31a354';
        if (percentage > 0.4) return '#74c476';
        if (percentage > 0.2) return '#bae4b3';
        return '#edf8e9';
    };

    let html = `<div style="display: grid; grid-template-columns: 150px repeat(7, 1fr); gap: 5px; text-align: center;">`;

    // Header Row
    html += `<div></div>`;
    days.forEach(day => {
        html += `<div style="font-weight: 700; font-size: 0.75rem; color: #64748b; text-transform: uppercase; padding-bottom: 5px;">${day}</div>`;
    });

    // Data Rows
    for (const staffName in heatmapData) {
        html += `<div style="font-weight: 600; font-size: 0.85rem; text-align: left; padding: 10px 0; color: #334155;">${staffName}</div>`;
        days.forEach(day => {
            const value = heatmapData[staffName][day];
            const color = getColorForValue(value);
            html += `<div title="${value} tickets" style="background-color: ${color}; color: ${value > maxVal*0.6 && value > 0 ? 'white' : 'black'}; border-radius: 4px; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; font-weight: 600; border: 1px solid rgba(0,0,0,0.05); transition: transform 0.2s; cursor: help;">${value}</div>`;
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// --- OPTIMIZED CHART RENDERING ---
function renderCharts(issues) {
    if (!document.getElementById('statusChart')) return;

    document.querySelectorAll('#tab-analytics canvas').forEach(canvas => {
        canvas.style.cursor = 'pointer';
    });
    
    const statusCounts = { 'Open': 0, 'Reopened': 0, 'In Progress': 0, 'Resolved': 0, 'Closed': 0 };
    const priorityCounts = { 'Low': 0, 'Medium': 0, 'High': 0 };
    const categoryCounts = {};
    const monthlyCounts = {};
    const staffStats = {}; 

    issues.forEach(i => {
        if(statusCounts[i.status] !== undefined) statusCounts[i.status]++;
        if(priorityCounts[i.priority] !== undefined) priorityCounts[i.priority]++;
        const cat = i.categories?.name || 'Uncategorized';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        const month = new Date(i.created_at).toLocaleString('default', { month: 'short' });
        monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
        if ((i.status === 'Resolved' || i.status === 'Closed') && i.assignee) {
            const name = i.assignee.name || i.assignee.email;
            const end = i.resolved_at ? new Date(i.resolved_at) : new Date();
            const start = new Date(i.created_at);
            const hours = (end - start) / (1000 * 60 * 60);
            if (!staffStats[name]) staffStats[name] = { totalTime: 0, count: 0 };
            staffStats[name].totalTime += hours;
            staffStats[name].count++;
        }
    });

    const getChartClickHandler = (chartType) => (evt, elements) => {
        if (elements.length > 0) {
            const chart = elements[0].chart;
            const index = elements[0].index;
            const label = chart.data.labels[index];
            filterIssuesFromChart(chartType, label);
        }
    };

    const createOrUpdateChart = (instance, ctx, config) => {
        if (instance) {
            instance.destroy();
        }
        return new Chart(ctx, config);
    };

    statusChartInstance = createOrUpdateChart(statusChartInstance, document.getElementById('statusChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#ef4444', '#8b5cf6', '#f59e0b', '#3b82f6', '#10b981'], borderWidth: 0 }] },
        options: { responsive: true, onClick: getChartClickHandler('status'), plugins: { title: { display: true, text: 'Ticket Status' } } }
    });

    priorityChartInstance = createOrUpdateChart(priorityChartInstance, document.getElementById('priorityChart').getContext('2d'), {
        type: 'bar',
        data: { labels: Object.keys(priorityCounts), datasets: [{ label: 'Count', data: Object.values(priorityCounts), backgroundColor: ['#94a3b8', '#d4af37', '#0f172a'], borderRadius: 5 }] },
        options: { responsive: true, onClick: getChartClickHandler('priority'), plugins: { legend: { display: false }, title: { display: true, text: 'Priority Breakdown' } }, scales: { y: { beginAtZero: true } } }
    });

    categoryChartInstance = createOrUpdateChart(categoryChartInstance, document.getElementById('categoryChart').getContext('2d'), {
        type: 'bar',
        data: { 
            labels: Object.keys(categoryCounts), 
            datasets: [{ 
                label: 'Issues', 
                data: Object.values(categoryCounts), 
                backgroundColor: ['#0f172a', '#7c3aed', '#f59e0b', '#0ea5e9', '#10b981'],
                borderRadius: 4 
            }] 
        },
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            onClick: getChartClickHandler('category'), 
            plugins: { 
                legend: { display: false },
                title: { display: true, text: 'Top Categories' } 
            } 
        }
    });

    trendChartInstance = createOrUpdateChart(trendChartInstance, document.getElementById('trendChart').getContext('2d'), {
        type: 'line',
        data: { labels: Object.keys(monthlyCounts), datasets: [{ label: 'Issues', data: Object.values(monthlyCounts), borderColor: '#d4af37', tension: 0.4, fill: true, backgroundColor: 'rgba(212, 175, 55, 0.1)' }] },
        options: { responsive: true, onClick: getChartClickHandler('month'), plugins: { title: { display: true, text: 'Monthly Volume' } } }
    });

    const staffNames = Object.keys(staffStats);
    const avgTimes = staffNames.map(name => (staffStats[name].totalTime / staffStats[name].count).toFixed(1));

    resolutionChartInstance = createOrUpdateChart(resolutionChartInstance, document.getElementById('resolutionChart').getContext('2d'), {
        type: 'bar',
        data: { labels: staffNames, datasets: [{ label: 'Avg Hours', data: avgTimes, backgroundColor: 'rgba(124, 58, 237, 0.7)', borderColor: '#7c3aed', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, onClick: getChartClickHandler('assignee'), plugins: { title: { display: true, text: 'Avg Resolution Time (Hours)' }, legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
    
    renderHeatmap(issues);
    renderChurnAnalysis(issues);
}


// ==========================================
// 8. SUPPORT DASHBOARD (UPDATED)
// ==========================================
function renderPriority(priority) {
    let prioClass = 'p-low';
    if(priority === 'High') prioClass = 'p-high';
    if(priority === 'Medium') prioClass = 'p-medium';
    return `<div class="priority-cell ${prioClass}"><span class="priority-dot"></span> ${priority}</div>`;
}

async function loadSupportIssues() {
    await runAutomations();
    const { data: { user } } = await supabase.auth.getUser();
    const filter = document.getElementById('filter-status')?.value || 'All';
    const search = document.getElementById('search-input')?.value || '';
    const tbody = document.getElementById('support-issues-table-body'); 
    const noMsg = document.getElementById('no-tasks-msg');
    const badge = document.getElementById('assigned-badge');
    if(!tbody) return;

    // --- KPI CALCULATIONS ---
    // Fetch all assigned issues for accurate KPI stats, ignoring table filters
    const { data: allAssignedIssues, error: kpiError } = await supabase
        .from('issues')
        .select('status, created_at, resolved_at')
        .eq('assigned_to', user.id);

    if (!kpiError && allAssignedIssues) {
        // 1. Pending Tickets
        const pendingIssues = allAssignedIssues.filter(i => ['Open', 'In Progress', 'Reopened'].includes(i.status)).length;
        document.getElementById('kpi-assigned').textContent = pendingIssues;

        // 2. Resolved Tickets (This Month)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const resolvedThisMonth = allAssignedIssues.filter(i =>
            (i.status === 'Resolved' || i.status === 'Closed') &&
            i.resolved_at &&
            new Date(i.resolved_at) >= startOfMonth
        ).length;
        document.getElementById('kpi-resolved').textContent = resolvedThisMonth;

        // 3. Average Resolution Time
        const resolvedWithTimes = allAssignedIssues.filter(i => (i.status === 'Resolved' || i.status === 'Closed') && i.created_at && i.resolved_at);
        let avgResolutionTimeText = 'N/A';
        if (resolvedWithTimes.length > 0) {
            const totalDurationHours = resolvedWithTimes.reduce((acc, i) => {
                const durationMs = new Date(i.resolved_at) - new Date(i.created_at);
                return acc + (durationMs / (1000 * 60 * 60)); // Convert to hours
            }, 0);
            const avgHours = totalDurationHours / resolvedWithTimes.length;
            avgResolutionTimeText = avgHours < 48 ? `${avgHours.toFixed(1)} hrs` : `${(avgHours / 24).toFixed(1)} days`;
        }
        document.getElementById('kpi-avg-time').textContent = avgResolutionTimeText;
    }

    // --- TABLE RENDERING ---
    let query = supabase.from('issues').select('*, categories(name), users!issues_user_id_fkey(name, email, organization, number)').eq('assigned_to', user.id).order('created_at', {ascending:false});
    
    if (filter !== 'All') query = query.eq('status', filter);
    if (search) query = query.ilike('title', `%${search}%`);
    
    const { data: issues, error } = await query;
    const { count: totalAssignedCount } = await supabase.from('issues').select('id', { count: 'exact' }).eq('assigned_to', user.id);

    supportIssuesList = issues || [];
    
    if (badge) badge.textContent = totalAssignedCount || 0;

    if(error) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Error: ${error.message}</td></tr>`; return; }
    if(supportIssuesList.length === 0) { 
        if(noMsg) noMsg.style.display = 'block'; 
        tbody.innerHTML = ''; 
        return; 
    }
    else { if(noMsg) noMsg.style.display = 'none'; }
    
    tbody.innerHTML = supportIssuesList.map((i, idx) => {
        let statusClass = `status-${i.status.toLowerCase().replace(' ', '-')}`;
        const reporterName = i.users?.name || i.users?.email || 'Unknown';
        const dateStr = formatDate(i.created_at);

        return `<tr>
            <td>
                <div style="font-weight: 600;">${i.title}</div>
                <div style="color: #9FA2B4; font-size: 0.8rem;">${i.categories?.name || 'General'}</div>
            </td>
            <td>
                <div>${reporterName}</div>
                <div style="color: #9FA2B4; font-size: 0.8rem;">${i.users?.organization || 'N/A'}</div>
            </td>
            <td>${dateStr}</td>
            <td>${renderPriority(i.priority)}</td>
            <td><span class="status-badge ${statusClass}">${i.status}</span></td>
            <td><button onclick="openSupportModal(${idx})" class="btn-action" style="background: var(--accent-blue);">Details</button></td>
        </tr>`;
    }).join('');
}

async function openSupportModal(index) {
    const issue = supportIssuesList[index];
    currentIssueId = issue.id;
    const modal = document.getElementById('support-issue-modal');
    if (!modal) return;
    
    const titleEl = document.getElementById('support-detail-title');
    const idEl = document.getElementById('support-detail-id');
    const descEl = document.getElementById('support-detail-desc');
    const statusSelectEl = document.getElementById('support-status-select');
    const userEl = document.getElementById('support-detail-user');
    const contactEl = document.getElementById('support-detail-contact');
    const imagesEl = document.getElementById('support-detail-images');
    const noteBox = document.getElementById('support-note-box');
    const noteText = document.getElementById('support-note-text');

    if(titleEl) titleEl.innerText = issue.title;
    if(idEl) idEl.innerText = issue.id;
    if(descEl) descEl.innerText = issue.description;
    if(statusSelectEl) statusSelectEl.value = issue.status;
    if(userEl) userEl.innerText = `${issue.users?.name || 'N/A'} / ${issue.users?.email || 'N/A'}`;
    if(contactEl) contactEl.innerText = issue.users?.number || 'Not provided';
    if(imagesEl) imagesEl.innerHTML = issue.images?.map(url => `<a href="${url}" target="_blank"><img src="${url}" class="attachment-thumb"></a>`).join('') || '<small style="color:#94a3b8;">No images</small>';
    
    if (noteBox && noteText) {
        if (issue.internal_note && issue.internal_note.trim() !== "") { 
            noteBox.style.display = 'block'; 
            noteText.innerText = issue.internal_note; 
        } else { 
            noteBox.style.display = 'none'; 
        }
    }

    updateTimelineVisual(issue.status, 'support-step-');
    loadComments(issue.id, 'support-chat-box');
    
    document.body.style.overflow = 'hidden';
    modal.style.display = 'block';
}

function closeSupportModal() { 
    currentIssueId = null; 
    const modal = document.getElementById('support-issue-modal');
    if(modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function supportUpdateStatus() {
    const s = document.getElementById('support-status-select').value;
    
    const updates = { status: s };
    if (s === 'Resolved' || s === 'Closed') {
        updates.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase.from('issues').update(updates).eq('id', currentIssueId);

    if (error) {
        showToast('Update failed: ' + error.message, 'error');
        return;
    }

    showToast('Task status has been updated.');
    closeSupportModal();
}

// ==========================================
// 9. PROFILE & UTILS
// ==========================================
async function goBackToDashboard() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (profile.role === 'admin') window.location.href = 'admin_dashboard.html';
    else if (profile.role === 'support') window.location.href = 'support_dashboard.html';
    else window.location.href = 'user_dashboard.html';
}
async function loadProfileData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }
    const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
    document.getElementById('profile-name').innerText = profile.name || 'User';
    document.getElementById('profile-email').innerText = profile.email;
    document.getElementById('profile-role').innerText = profile.role;
    document.getElementById('profile-date').innerText = formatDate(profile.created_at);
    if(profile.organization) document.getElementById('profile-org').innerText = profile.organization;
    document.getElementById('avatar-initials').innerText = (profile.name || profile.email).charAt(0).toUpperCase();
    const nav = document.getElementById('profile-nav');
    if(profile.role === 'admin') nav.style.background = '#0f172a';
    else if(profile.role === 'support') nav.style.background = 'linear-gradient(90deg, #7c3aed, #6d28d9)';
    else nav.style.background = '#334155';
    const statsGrid = document.getElementById('stats-grid');
    if(!statsGrid) return;
    statsGrid.innerHTML = 'Loading...';
    if (profile.role === 'user') {
        const { data: issues } = await supabase.from('issues').select('status').eq('user_id', user.id);
        const total = issues.length, open = issues.filter(i => ['Open', 'Reopened'].includes(i.status)).length, solved = issues.filter(i => i.status === 'Closed' || i.status === 'Resolved').length;
        statsGrid.innerHTML = `${renderStatCard(total, 'Total Issues')} ${renderStatCard(open, 'Open')} ${renderStatCard(solved, 'Resolved')}`;
    } else if (profile.role === 'support') {
        const { data: issues } = await supabase.from('issues').select('status').eq('assigned_to', user.id);
        const total = issues.length, solved = issues.filter(i => i.status === 'Closed' || i.status === 'Resolved').length, pending = issues.filter(i => ['Open', 'In Progress', 'Reopened'].includes(i.status)).length;
        statsGrid.innerHTML = `${renderStatCard(total, 'Assigned')} ${renderStatCard(solved, 'Solved')} ${renderStatCard(pending, 'Pending')}`;
    } else if (profile.role === 'admin') {
        const { data: issues } = await supabase.from('issues').select('status, assigned_to');
        const { data: staff } = await supabase.from('users').select('id, name, email').eq('role', 'support');
        const total = issues.length, reopens = issues.filter(i => ['Open', 'Reopened'].includes(i.status)).length, unassigned = issues.filter(i => i.assigned_to === null).length;
        statsGrid.innerHTML = `${renderStatCard(total, 'Total Issues')} ${renderStatCard(reopens, 'Active')} ${renderStatCard(unassigned, 'Unassigned')}`;
        document.getElementById('admin-breakdown-section').style.display = 'block';
        const tbody = document.querySelector('#staff-stats-table tbody');
        tbody.innerHTML = staff.map(s => {
            const staffIssues = issues.filter(i => i.assigned_to === s.id);
            const sTotal = staffIssues.length, sPending = staffIssues.filter(i => ['Open', 'In Progress', 'Reopened'].includes(i.status)).length, sSolved = staffIssues.filter(i => i.status === 'Closed' || i.status === 'Resolved').length;
            return `<tr><td style="font-weight:600; color:var(--navy-light);">${s.name || s.email}</td><td>${sTotal}</td><td>${sPending}</td><td>${sSolved}</td></tr>`;
        }).join('');
    }
}
function renderStatCard(n, l) { return `<div class="stat-card"><span class="stat-number">${n}</span><span class="stat-label">${l}</span></div>`; }

async function loadComments(issueId, cid) {
    const box = document.getElementById(cid); box.innerHTML = 'Loading...';
    const { data: comments } = await supabase.from('comments').select('*, users(name, email, role)').eq('issue_id', issueId).order('created_at');
    const { data: { user } } = await supabase.auth.getUser();
    box.innerHTML = comments?.length ? comments.map(c => `<div class="message ${c.user_id===user.id?'mine':'theirs'}"><b>${c.user_id===user.id?'You':(c.users?.name||c.users?.email)}:</b> ${c.message}</div>`).join('') : '<div style="text-align:center; padding:20px; color:#94a3b8;">No discussion</div>';
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 100);
}
async function submitComment(iid, cid) {
    const m = document.getElementById(iid).value; if(!m)return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('comments').insert({issue_id:currentIssueId, user_id:user.id, message:m});
    document.getElementById(iid).value=''; loadComments(currentIssueId, cid);
}
async function adminPostComment() { await submitComment('admin-chat-input', 'admin-chat-box'); }
async function supportPostComment() { await submitComment('support-chat-input', 'support-chat-box'); }
async function postComment() { await submitComment('chat-input', 'chat-box'); }
function updateTimelineVisual(s, p) { 
    if (s === 'Reopened') s = 'Open';
    ['Open','In Progress','Resolved','Closed'].forEach(x => { 
        const e = document.getElementById(p+x); 
        if(e) e.className = 'timeline-step ' + (x===s?'active':''); 
    }); 
}