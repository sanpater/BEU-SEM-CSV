let allData = []; // Raw rows from CSV(s)
let filteredData = []; // Filtered raw rows
let groupedData = []; // Grouped by student regNo based on filteredData

const rowsPerPage = 12;
let currentPage = 1;
let currentChart = null;

// Elements
const searchInput = document.getElementById('searchInput');
const batchFilter = document.getElementById('batchFilter');
const semesterFilter = document.getElementById('semesterFilter');
const collegeFilter = document.getElementById('collegeFilter');
const branchFilter = document.getElementById('branchFilter');
const sortFilter = document.getElementById('sortFilter');
const searchBtn = document.getElementById('searchBtn');
const resultsArea = document.getElementById('resultsArea');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const totalRecords = document.getElementById('totalRecords');
const paginationNav = document.getElementById('paginationNav');
const paginationList = document.getElementById('paginationList');
const studentModal = new bootstrap.Modal(document.getElementById('studentModal'));
const themeToggleBtn = document.getElementById('themeToggle');

// Stats Elements
const statTotal = document.getElementById('statTotal');
const statPassRate = document.getElementById('statPassRate');
const statAvgSgpa = document.getElementById('statAvgSgpa');

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadCSVData();

    // Event listeners
    searchBtn.addEventListener('click', applyFilters);
    searchInput.addEventListener('keyup', (e) => {
        if(e.key === 'Enter') applyFilters();
    });
    batchFilter.addEventListener('change', handleFilterChange);
    semesterFilter.addEventListener('change', handleFilterChange);
    collegeFilter.addEventListener('change', applyFilters);
    branchFilter.addEventListener('change', applyFilters);
    sortFilter.addEventListener('change', applyFilters);
    themeToggleBtn.addEventListener('click', toggleTheme);
});

// Theme Logic
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);

    // Re-render chart if open to match theme
    if(currentChart && document.getElementById('studentModal').classList.contains('show')) {
        // Redraw chart with new theme colors
        const activeRegNo = document.getElementById('modalTitle').getAttribute('data-reg');
        if(activeRegNo) renderChartForStudent(activeRegNo);
    }
}

function updateThemeIcon(theme) {
    const icon = themeToggleBtn.querySelector('i');
    const span = themeToggleBtn.querySelector('span');
    if (theme === 'dark') {
        icon.className = 'fas fa-sun text-warning';
        span.textContent = 'Light Mode';
        themeToggleBtn.classList.replace('btn-outline-dark', 'btn-outline-light');
    } else {
        icon.className = 'fas fa-moon';
        span.textContent = 'Dark Mode';
        themeToggleBtn.classList.replace('btn-outline-light', 'btn-outline-dark');
    }
}

let indexData = [];
let currentCsvFile = "";

// Define all possible standard B.Tech batches and semesters
const KNOWN_BATCHES = ["2020", "2021", "2022", "2023", "2024", "2025"];
const KNOWN_SEMESTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];

async function loadCSVData() {
    loading.classList.remove('d-none');
    
    indexData = [];
    KNOWN_BATCHES.forEach(b => {
        KNOWN_SEMESTERS.forEach(s => {
            indexData.push({ batch: b, semester: s, file: `${b}_sem${s}.csv` });
        });
    });
    
    indexData.sort((a,b) => {
        if(b.batch !== a.batch) return b.batch.localeCompare(a.batch);
        return parseInt(a.semester) - parseInt(b.semester);
    });
    
    populateBatchSemesterDropdowns();
    
    // Default to a specific batch but "All Semesters" if possible to show off the merging
    batchFilter.value = "2024";
    semesterFilter.value = ""; // Empty string = All Semesters
    await handleFilterChange();
}

// Global variable to track currently loaded CSVs so we don't over-fetch
let currentlyLoadedCSVs = [];

async function handleFilterChange() {
    const batch = batchFilter.value;
    const sem = semesterFilter.value;
    
    let filesToFetch = [];
    
    if (batch && sem) {
        filesToFetch.push(`${batch}_sem${sem}.csv`);
    } else if (batch && !sem) {
        // All semesters for a specific batch
        filesToFetch = KNOWN_SEMESTERS.map(s => `${batch}_sem${s}.csv`);
    } else if (!batch && sem) {
        // All batches for a specific semester
        filesToFetch = KNOWN_BATCHES.map(b => `${b}_sem${sem}.csv`);
    } else {
        // Everything - could be heavy but we'll allow it
        filesToFetch = indexData.map(i => i.file);
    }
    
    // If we're already viewing exactly these files, just re-filter
    const targetKey = filesToFetch.sort().join(',');
    const currentKey = currentlyLoadedCSVs.sort().join(',');
    
    if (targetKey === currentKey && allData.length > 0) {
        applyFilters();
        return;
    }
    
    await loadMultipleCSVs(filesToFetch);
}

async function loadMultipleCSVs(filenames) {
    loading.classList.remove('d-none');
    errorMsg.classList.add('d-none');
    resultsArea.innerHTML = '';
    currentlyLoadedCSVs = [...filenames];
    
    allData = [];
    
    // Concurrently fetch all files
    const fetchPromises = filenames.map(async (filename) => {
        try {
            const check = await fetch(filename, { method: 'HEAD' });
            if (!check.ok) return null; // File missing, skip
            
            return new Promise((resolve) => {
                Papa.parse(filename, {
                    download: true,
                    header: true,
                    skipEmptyLines: true,
                    complete: function(res) {
                        res.data.forEach(row => {
                            if(row.regNo) {
                                row.sgpaNum = parseFloat(row.sgpa) || 0;
                                row.sourceFile = filename;
                                allData.push(row);
                            }
                        });
                        resolve(true);
                    },
                    error: function() { resolve(false); }
                });
            });
        } catch(e) {
            return null;
        }
    });
    
    await Promise.all(fetchPromises);
    
    if (allData.length === 0) {
        loading.classList.add('d-none');
        filteredData = [];
        groupedData = [];
        updateStats();
        renderPage(1);
        
        let msg = "Data for the selected filters has not been uploaded yet.";
        resultsArea.innerHTML = `<div class="col-12 text-center py-5">
            <i class="fas fa-folder-open fs-1 text-muted opacity-50 mb-3"></i>
            <h5 class="text-muted fw-bold">No Records Found</h5>
            <p class="text-muted small">${msg}</p>
        </div>`;
        return;
    }

    totalRecords.textContent = allData.length;
    populateSecondaryFilters();
    await applyFilters();
    loading.classList.add('d-none');
}

function updateStats() {
    if(groupedData.length === 0) {
        statTotal.textContent = "0";
        statPassRate.textContent = "0%";
        statAvgSgpa.textContent = "0.00";
        return;
    }

    statTotal.textContent = groupedData.length.toLocaleString();

    let passCount = 0;
    let totalSgpa = 0;
    let sgpaCount = 0;

    groupedData.forEach(student => {
        if(student.isOverallPass) passCount++;

        if(student.avgSgpa > 0) {
            totalSgpa += student.avgSgpa;
            sgpaCount++;
        }
    });

    const passRate = (passCount / groupedData.length) * 100;
    statPassRate.textContent = passRate.toFixed(1) + "%";

    const avgSgpa = sgpaCount > 0 ? (totalSgpa / sgpaCount) : 0;
    statAvgSgpa.textContent = avgSgpa.toFixed(2);
}

function populateFilters() {
    const batches = new Set();
    const semesters = new Set();
    const colleges = new Set();
    const branches = new Set();

    allData.forEach(row => {
        if(row.Session) batches.add(row.Session);
        if(row.semester) semesters.add(row.semester);
        if(row.college_name) colleges.add(row.college_name);
        if(row.course) branches.add(row.course);
    });

    Array.from(batches).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b; opt.textContent = b;
        batchFilter.appendChild(opt);
    });

    // Roman numeral sort helper
    const romanMap = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8 };
    Array.from(semesters).sort((a, b) => (romanMap[a] || 99) - (romanMap[b] || 99)).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        semesterFilter.appendChild(opt);
    });

    Array.from(colleges).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        collegeFilter.appendChild(opt);
    });

    Array.from(branches).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b; opt.textContent = b;
        branchFilter.appendChild(opt);
    });
}

async function applyFilters() {
    const term = searchInput.value.toLowerCase().trim();
    const college = collegeFilter.value;
    const branch = branchFilter.value;

    filteredData = allData.filter(row => {
        const matchSearch = term === '' ||
                            (row.regNo && row.regNo.toLowerCase().includes(term)) ||
                            (row.name && row.name.toLowerCase().includes(term));

        const matchCollege = college === '' || row.college_name === college;
        const matchBranch = branch === '' || row.course === branch;

        return matchSearch && matchCollege && matchBranch;
    });

    groupFilteredData();
    sortData();
    updateStats();
    currentPage = 1;
    renderPage(1);
}

function groupFilteredData() {
    const studentMap = {};
    
    filteredData.forEach(row => {
        const regNo = row.regNo;
        if (!studentMap[regNo]) {
            studentMap[regNo] = {
                regNo: row.regNo,
                name: row.name,
                father_name: row.father_name,
                mother_name: row.mother_name,
                college_name: row.college_name,
                course: row.course,
                semesters: [],
                passCount: 0,
                totalSgpa: 0,
                sgpaCount: 0,
                records: []
            };
        }
        
        studentMap[regNo].records.push(row);
        
        const semName = row.semester || "Unknown";
        if (!studentMap[regNo].semesters.includes(semName)) {
            studentMap[regNo].semesters.push(semName);
        }
        
        if(row.fail_any === 'PASS') studentMap[regNo].passCount++;
        
        const sgpa = parseFloat(row.sgpa);
        if(!isNaN(sgpa) && sgpa > 0) {
            studentMap[regNo].totalSgpa += sgpa;
            studentMap[regNo].sgpaCount++;
        }
    });
    
    groupedData = Object.values(studentMap).map(student => {
        // Calculate cumulative properties
        student.isOverallPass = student.passCount === student.records.length;
        student.avgSgpa = student.sgpaCount > 0 ? (student.totalSgpa / student.sgpaCount) : 0;
        
        // Sort semester names intuitively (I, II, III, IV, etc. or 1, 2, 3)
        const romanMap = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8 };
        student.semesters.sort((a,b) => (romanMap[a] || parseInt(a) || 99) - (romanMap[b] || parseInt(b) || 99));
        
        return student;
    });
}

function sortData() {
    const sortVal = sortFilter.value;

    groupedData.sort((a, b) => {
        if (sortVal === 'name_asc') {
            return (a.name || '').localeCompare(b.name || '');
        } else if (sortVal === 'sgpa_desc') {
            return b.avgSgpa - a.avgSgpa;
        } else if (sortVal === 'sgpa_asc') {
            return a.avgSgpa - b.avgSgpa;
        }
        return 0;
    });
}

function renderPage(page) {
    currentPage = page;
    resultsArea.innerHTML = '';

    if(groupedData.length === 0) {
        resultsArea.innerHTML = `<div class="col-12 text-center py-5 text-muted">
            <i class="fas fa-folder-open fa-4x mb-3 text-secondary opacity-50"></i>
            <h4>No records found</h4>
            <p>Try adjusting your search or filters.</p>
        </div>`;
        paginationNav.style.display = 'none';
        return;
    }

    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedItems = groupedData.slice(start, end);

    paginatedItems.forEach((studentGroup, index) => {
        const isPass = studentGroup.isOverallPass;
        const badgeClass = isPass ? 'pass-status' : 'fail-status';
        const statusText = isPass ? 'CLEAR' : 'BACKLOGS';

        // Calculate total marks across all semesters
        let totalScore = 0;
        studentGroup.records.forEach(record => {
            Object.keys(record).forEach(key => {
                if(key.endsWith('_total') && record[key]) {
                    totalScore += parseInt(record[key] || 0);
                }
            });
        });

        // Staggered animation delay
        const delay = (index % 12) * 0.05;

        const card = document.createElement('div');
        card.className = 'col-lg-4 col-md-6 mb-4';
        card.style.animationDelay = `${delay}s`;
        
        // Multi-semester badge string
        const semestersText = studentGroup.semesters.length > 1 ? `${studentGroup.semesters.length} Semesters` : `Sem ${studentGroup.semesters[0]}`;

        card.innerHTML = `
            <div class="card h-100 student-card" onclick="showStudentDetails('${studentGroup.regNo}')">
                <span class="status-badge ${badgeClass} fw-bold"><i class="fas ${isPass ? 'fa-check-circle' : 'fa-times-circle'} me-1"></i>${statusText}</span>
                <div class="card-body p-4 d-flex flex-column">
                    <div class="d-flex align-items-center mb-4">
                        <div class="avatar-circle text-white rounded-circle d-flex align-items-center justify-content-center fw-bold me-3 shadow-sm flex-shrink-0">
                            ${studentGroup.name ? studentGroup.name.charAt(0) : '?'}
                        </div>
                        <div class="overflow-hidden">
                            <h5 class="card-title mb-1 fw-bold text-truncate" title="${studentGroup.name}">${studentGroup.name}</h5>
                            <small class="text-muted"><i class="fas fa-id-card me-1"></i>${studentGroup.regNo}</small>
                        </div>
                    </div>

                    <div class="small mb-4 text-muted flex-grow-1">
                        <div class="text-truncate mb-2" title="${studentGroup.course}"><i class="fas fa-book me-2 text-primary opacity-75"></i>${studentGroup.course}</div>
                        <div class="text-truncate mb-2" title="${studentGroup.college_name}"><i class="fas fa-university me-2 text-primary opacity-75"></i>${studentGroup.college_name}</div>
                        <div class="text-truncate text-primary fw-bold"><i class="fas fa-layer-group me-2 opacity-75"></i>${semestersText}</div>
                    </div>

                    <div class="row g-0 pt-3 border-top mt-auto text-center">
                        <div class="col-6 border-end">
                            <span class="d-block small text-muted text-uppercase fw-bold mb-1" style="font-size: 0.7rem; letter-spacing: 0.5px;">AVG SGPA</span>
                            <span class="fs-4 fw-bold ${studentGroup.avgSgpa >= 8 ? 'text-success' : 'text-primary'}">${studentGroup.avgSgpa.toFixed(2) || 'N/A'}</span>
                        </div>
                        <div class="col-6">
                            <span class="d-block small text-muted text-uppercase fw-bold mb-1" style="font-size: 0.7rem; letter-spacing: 0.5px;">Total Marks</span>
                            <span class="fs-4 fw-bold">${totalScore}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        resultsArea.appendChild(card);
    });

    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(groupedData.length / rowsPerPage);
    paginationList.innerHTML = '';

    if (totalPages <= 1) {
        paginationNav.style.display = 'none';
        return;
    }

    paginationNav.style.display = 'flex';

    const createBtn = (text, pageNum, disabled, active) => {
        const li = document.createElement('li');
        li.className = `page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link shadow-sm fw-bold" href="#" onclick="event.preventDefault(); if(!${disabled}) renderPage(${pageNum})">${text}</a>`;
        return li;
    };

    paginationList.appendChild(createBtn('<i class="fas fa-chevron-left"></i>', currentPage - 1, currentPage === 1, false));

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if(endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    if (startPage > 1) {
        paginationList.appendChild(createBtn('1', 1, false, false));
        if (startPage > 2) {
            const el = document.createElement('li');
            el.className = 'page-item disabled'; el.innerHTML = '<span class="page-link border-0 bg-transparent">...</span>';
            paginationList.appendChild(el);
        }
    }

    for(let i = startPage; i <= endPage; i++) {
        paginationList.appendChild(createBtn(i, i, false, currentPage === i));
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const el = document.createElement('li');
            el.className = 'page-item disabled'; el.innerHTML = '<span class="page-link border-0 bg-transparent">...</span>';
            paginationList.appendChild(el);
        }
        paginationList.appendChild(createBtn(totalPages, totalPages, false, false));
    }

    paginationList.appendChild(createBtn('<i class="fas fa-chevron-right"></i>', currentPage + 1, currentPage === totalPages, false));
}

// Ensure the student details modal function is accessible globally
window.showStudentDetails = function(regNo) {
    const studentGroup = groupedData.find(s => s.regNo === regNo);
    if(!studentGroup) return;

    // Store active student for theme switching
    document.getElementById('modalTitle').setAttribute('data-reg', regNo);
    document.getElementById('modalTitle').textContent = `${studentGroup.name} - Official Record`;

    const isPass = studentGroup.isOverallPass;
    
    // Sort records by semester numerically
    const romanMap = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8 };
    const sortedRecords = [...studentGroup.records].sort((a,b) => {
        const aVal = romanMap[a.semester] || parseInt(a.semester) || 99;
        const bVal = romanMap[b.semester] || parseInt(b.semester) || 99;
        return aVal - bVal;
    });

    let accordionHtml = '';
    
    sortedRecords.forEach((record, idx) => {
        const isSemPass = record.fail_any === 'PASS';
        const collapseId = `collapseSem${idx}`;
        const headingId = `headingSem${idx}`;
        const isExpanded = idx === 0 ? 'true' : 'false';
        const showClass = idx === 0 ? 'show' : '';

        const subjects = [];
        const subjectNames = new Set();

        Object.keys(record).forEach(key => {
            if(key.endsWith('_code')) {
                const name = key.replace('_code', '');
                subjectNames.add(name);
            }
        });

        subjectNames.forEach(name => {
            if(record[`${name}_code`]) {
                subjects.push({
                    name: name,
                    code: record[`${name}_code`],
                    ese: parseInt(record[`${name}_ese`]) || 0,
                    ia: parseInt(record[`${name}_ia`]) || 0,
                    total: parseInt(record[`${name}_total`]) || 0,
                    grade: record[`${name}_grade`] || '-',
                    credit: record[`${name}_credit`] || '-'
                });
            }
        });

        subjects.sort((a,b) => a.code.localeCompare(b.code));

        let subjectsHtml = '';
        let totalCredits = 0;
        let grandTotal = 0;

        subjects.forEach(sub => {
            let gClass = 'grade-P';
            if(sub.grade === 'O' || sub.grade === 'A+') gClass = 'grade-O';
            else if(sub.grade === 'A') gClass = 'grade-A';
            else if(sub.grade === 'B') gClass = 'grade-B';
            else if(sub.grade === 'C') gClass = 'grade-C';
            else if(sub.grade === 'D') gClass = 'grade-D';
            else if(sub.grade === 'F') gClass = 'grade-F';

            totalCredits += parseFloat(sub.credit) || 0;
            grandTotal += sub.total;

            subjectsHtml += `
                <tr>
                    <td class="text-muted font-monospace small">${sub.code}</td>
                    <td class="fw-bold">${sub.name}</td>
                    <td class="text-center text-muted">${sub.credit}</td>
                    <td class="text-center">${sub.ese || '-'}</td>
                    <td class="text-center">${sub.ia || '-'}</td>
                    <td class="text-center fw-bold text-primary">${sub.total || '-'}</td>
                    <td class="text-center"><span class="grade-box ${gClass}">${sub.grade}</span></td>
                </tr>
            `;
        });

        accordionHtml += `
            <div class="accordion-item border mb-3 rounded shadow-sm">
                <h2 class="accordion-header" id="${headingId}">
                    <button class="accordion-button ${idx === 0 ? '' : 'collapsed'} fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${isExpanded}" aria-controls="${collapseId}">
                        <div class="d-flex justify-content-between align-items-center w-100 pe-3">
                            <span><i class="fas fa-calendar-alt me-2 text-primary"></i>Semester ${record.semester} <small class="text-muted ms-2 fw-normal">(${record.exam_held || ''})</small></span>
                            <span class="badge ${isSemPass ? 'bg-success' : 'bg-danger'} ms-auto">SGPA: ${record.sgpaNum.toFixed(2)} - ${isSemPass ? 'PASS' : 'FAIL'}</span>
                        </div>
                    </button>
                </h2>
                <div id="${collapseId}" class="accordion-collapse collapse ${showClass}" aria-labelledby="${headingId}" data-bs-parent="#semAccordion">
                    <div class="accordion-body p-0">
                        <div class="table-responsive">
                            <table class="table table-hover table-custom align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th width="12%">Code</th>
                                        <th width="35%">Subject Name</th>
                                        <th width="8%" class="text-center">Credit</th>
                                        <th width="10%" class="text-center">ESE <small>(Ext)</small></th>
                                        <th width="10%" class="text-center">IA <small>(Int)</small></th>
                                        <th width="10%" class="text-center text-primary">Total</th>
                                        <th width="15%" class="text-center">Grade</th>
                                    </tr>
                                </thead>
                                <tbody>${subjectsHtml}</tbody>
                                <tfoot class="bg-light">
                                    <tr>
                                        <td colspan="2" class="text-end fw-bold text-muted text-uppercase">Total:</td>
                                        <td class="text-center fw-bold">${totalCredits}</td>
                                        <td colspan="2"></td>
                                        <td class="text-center fw-bold fs-5 text-primary">${grandTotal}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        ${!isSemPass ? `<div class="alert alert-danger m-3 py-2 small fw-bold text-center border-0"><i class="fas fa-exclamation-triangle me-2"></i> BACKLOG: ${record.fail_any.replace('FAIL:', '')}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    const bodyHtml = `
        <div class="modal-header-info p-4 p-md-5">
            <div class="row align-items-center">
                <div class="col-md-7 mb-4 mb-md-0">
                    <div class="d-flex align-items-center mb-4">
                        <div class="avatar-circle text-white rounded d-flex align-items-center justify-content-center fw-bold me-4 shadow flex-shrink-0" style="width: 80px; height: 80px; font-size: 2rem;">
                            ${studentGroup.name.charAt(0)}
                        </div>
                        <div>
                            <h3 class="mb-1 fw-bold text-primary">${studentGroup.name}</h3>
                            <div class="text-muted fs-5"><i class="fas fa-id-card me-2"></i>${studentGroup.regNo}</div>
                        </div>
                    </div>
                    <table class="table table-sm table-borderless mb-0">
                        <tr><td class="text-muted w-25 pb-2"><i class="fas fa-user-tie me-2"></i>Father:</td><td class="fw-bold pb-2">${studentGroup.father_name}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="fas fa-user me-2"></i>Mother:</td><td class="fw-bold pb-2">${studentGroup.mother_name}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="fas fa-book-open me-2"></i>Course:</td><td class="fw-bold pb-2">${studentGroup.course}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="fas fa-university me-2"></i>College:</td><td class="fw-bold pb-2">${studentGroup.college_name}</td></tr>
                    </table>
                </div>
                <div class="col-md-5">
                    <div class="card border-0 shadow-sm bg-white mb-3" style="border-radius: 15px;">
                        <div class="card-body p-4 text-center">
                            <span class="d-block text-muted text-uppercase fw-bold mb-2 small" style="letter-spacing: 1px;">Overall Average SGPA</span>
                            <div class="d-flex justify-content-center align-items-end gap-3 mb-3">
                                <div>
                                    <h1 class="display-3 fw-bold mb-0 ${studentGroup.avgSgpa >= 8 ? 'text-success' : 'text-primary'}">${studentGroup.avgSgpa.toFixed(2)}</h1>
                                    <span class="text-muted fw-bold small">ACROSS ${sortedRecords.length} SEMESTERS</span>
                                </div>
                            </div>
                            <span class="badge ${isPass ? 'bg-success' : 'bg-danger'} px-4 py-2 fs-6 rounded-pill w-100 shadow-sm">
                                <i class="fas ${isPass ? 'fa-check-circle' : 'fa-times-circle'} me-1"></i> OVERALL: ${isPass ? 'CLEAR' : 'BACKLOGS PRESENT'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="p-4 p-md-5">
            <ul class="nav nav-tabs mb-4" id="myTab" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active fw-bold" id="marks-tab" data-bs-toggle="tab" data-bs-target="#marks" type="button" role="tab"><i class="fas fa-list-alt me-2"></i>Academic History</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link fw-bold" id="chart-tab" data-bs-toggle="tab" data-bs-target="#chart" type="button" role="tab" onclick="renderChartForStudent('${studentGroup.regNo}')"><i class="fas fa-chart-line me-2"></i>Performance Chart</button>
                </li>
            </ul>

            <div class="tab-content" id="myTabContent">
                <div class="tab-pane fade show active" id="marks" role="tabpanel">
                    <div class="accordion" id="semAccordion">
                        ${accordionHtml}
                    </div>
                </div>

                <div class="tab-pane fade" id="chart" role="tabpanel">
                    <div class="chart-container rounded p-3 border shadow-sm" style="background: var(--bg-card)">
                        <canvas id="performanceChart"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalBody').innerHTML = bodyHtml;
    studentModal.show();
}

window.renderChartForStudent = function(regNo) {
    const studentGroup = groupedData.find(s => s.regNo === regNo);
    if(!studentGroup) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#666';
    const gridColor = isDark ? '#333' : '#e5e5e5';

    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;

    if (currentChart) {
        currentChart.destroy();
    }
    
    // Sort records logically
    const romanMap = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8 };
    const sortedRecords = [...studentGroup.records].sort((a,b) => {
        return (romanMap[a.semester] || parseInt(a.semester) || 99) - (romanMap[b.semester] || parseInt(b.semester) || 99);
    });

    if (sortedRecords.length > 1) {
        // Multi-semester: Line Chart for SGPA Progression
        const labels = sortedRecords.map(r => `Sem ${r.semester}`);
        const sgpaData = sortedRecords.map(r => r.sgpaNum);
        
        currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'SGPA Progression',
                    data: sgpaData,
                    borderColor: 'rgb(78, 115, 223)',
                    backgroundColor: 'rgba(78, 115, 223, 0.2)',
                    borderWidth: 3,
                    pointBackgroundColor: 'rgb(28, 200, 138)',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor, font: { weight: 'bold' } } },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: {
                        ticks: { color: textColor, font: { weight: 'bold' } },
                        grid: { color: gridColor, display: false }
                    },
                    y: {
                        min: 0,
                        max: 10,
                        ticks: { color: textColor },
                        grid: { color: gridColor },
                        title: { display: true, text: 'SGPA', color: textColor, font: { weight: 'bold' } }
                    }
                }
            }
        });
    } else {
        // Single semester: Bar Chart for Subject Marks
        const student = sortedRecords[0];
        const subjects = [];
        Object.keys(student).forEach(key => {
            if(key.endsWith('_code') && student[key]) {
                const name = key.replace('_code', '');
                const subName = student[`${name}_code`];
                const ese = parseInt(student[`${name}_ese`]) || 0;
                const ia = parseInt(student[`${name}_ia`]) || 0;
                if (ese > 0 || ia > 0) {
                    subjects.push({ label: subName, name: name, ese: ese, ia: ia });
                }
            }
        });

        subjects.sort((a,b) => a.label.localeCompare(b.label));

        currentChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: subjects.map(s => s.label),
                datasets: [
                    {
                        label: 'External (ESE)',
                        data: subjects.map(s => s.ese),
                        backgroundColor: 'rgba(78, 115, 223, 0.8)',
                        borderColor: 'rgb(78, 115, 223)',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Internal (IA)',
                        data: subjects.map(s => s.ia),
                        backgroundColor: 'rgba(28, 200, 138, 0.8)',
                        borderColor: 'rgb(28, 200, 138)',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor, font: { weight: 'bold' } } },
                    tooltip: {
                        mode: 'index', intersect: false,
                        callbacks: {
                            title: function(context) {
                                const idx = context[0].dataIndex;
                                return subjects[idx].name;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        ticks: { color: textColor, font: { weight: 'bold' } },
                        grid: { color: gridColor, display: false }
                    },
                    y: {
                        stacked: true,
                        ticks: { color: textColor },
                        grid: { color: gridColor },
                        title: { display: true, text: 'Marks', color: textColor, font: { weight: 'bold' } }
                    }
                }
            }
        });
    }
}

function showError(msg) {
    errorText.textContent = msg;
    errorMsg.classList.remove('d-none');
}

function populateBatchSemesterDropdowns() {
    batchFilter.innerHTML = '<option value="">All Batches</option>';
    semesterFilter.innerHTML = '<option value="">All Semesters</option>';
    
    const batches = [...new Set(indexData.map(item => item.batch))].sort((a,b) => b.localeCompare(a));
    const semesters = [...new Set(indexData.map(item => item.semester))].sort((a,b) => a - b);
    
    batches.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b; opt.textContent = b;
        batchFilter.appendChild(opt);
    });
    
    semesters.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = `Semester ${s}`;
        semesterFilter.appendChild(opt);
    });
}

function populateSecondaryFilters() {
    const colleges = new Set();
    const branches = new Set();

    allData.forEach(row => {
        if(row.college_name) colleges.add(row.college_name);
        if(row.course) branches.add(row.course);
    });

    const currCol = collegeFilter.value;
    const currBranch = branchFilter.value;

    collegeFilter.innerHTML = '<option value="">All Colleges</option>';
    branchFilter.innerHTML = '<option value="">All Branches</option>';

    Array.from(colleges).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        collegeFilter.appendChild(opt);
    });

    Array.from(branches).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b; opt.textContent = b;
        branchFilter.appendChild(opt);
    });

    if(currCol && colleges.has(currCol)) collegeFilter.value = currCol;
    if(currBranch && branches.has(currBranch)) branchFilter.value = currBranch;
}
