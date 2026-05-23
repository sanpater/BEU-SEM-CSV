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
const themeToggleDarkBtn = document.getElementById('themeToggleDark');
const themeToggleLightBtn = document.getElementById('themeToggleLight');

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
    collegeFilter.addEventListener('change', () => {
        updateBranchDropdown();
        applyFilters();
    });
    branchFilter.addEventListener('change', applyFilters);
    sortFilter.addEventListener('change', applyFilters);
    window.addEventListener('resize', () => {
        if (groupedData.length > 0) {
            renderPagination();
        }
    });

    if (themeToggleDarkBtn) {
        themeToggleDarkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            setTheme('dark');
        });
    }

    if (themeToggleLightBtn) {
        themeToggleLightBtn.addEventListener('click', (e) => {
            e.preventDefault();
            setTheme('light');
        });
    }
});

// Theme Logic
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme, false);
}

function setTheme(theme, reRenderChart = true) {
    document.body.setAttribute('data-bs-theme', theme);
    localStorage.setItem('theme', theme);

    if (theme === 'dark') {
        if (themeToggleDarkBtn) themeToggleDarkBtn.style.display = 'none';
        if (themeToggleLightBtn) themeToggleLightBtn.style.display = 'block';
    } else {
        if (themeToggleDarkBtn) themeToggleDarkBtn.style.display = 'block';
        if (themeToggleLightBtn) themeToggleLightBtn.style.display = 'none';
    }

    // Re-render chart if open to match theme
    if(reRenderChart && currentChart && document.getElementById('studentModal').classList.contains('show')) {
        // Redraw chart with new theme colors
        const activeRegNo = document.getElementById('modalTitle').getAttribute('data-reg');
        if(activeRegNo) renderChartForStudent(activeRegNo);
    }
}

let indexData = [];
let currentCsvFile = "";

// Define all possible standard B.Tech batches and semesters
const KNOWN_BATCHES = ["2020", "2021", "2022", "2023", "2024", "2025"];
const KNOWN_SEMESTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];

function isEvenSemester(semStr) {
    if (!semStr) return false;
    const s = semStr.toUpperCase();
    return s === "II" || s === "IV" || s === "VI" || s === "VIII" || s === "2" || s === "4" || s === "6" || s === "8";
}

async function loadCSVData() {
    loading.classList.remove('d-none');
    
    try {
        const response = await fetch('index.json');
        if (!response.ok) throw new Error('Failed to load index.json');
        indexData = await response.json();
    } catch (e) {
        console.error(e);
        indexData = [];
    }
    
    indexData.sort((a,b) => {
        if(b.batch !== a.batch) return b.batch.localeCompare(a.batch);
        return parseInt(b.semester) - parseInt(a.semester);
    });
    
    populateBatchSemesterDropdowns();
    
    if (indexData.length > 0) {
        batchFilter.value = indexData[0].batch;
        semesterFilter.value = indexData[0].semester;
    }
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
        return new Promise((resolve) => {
            Papa.parse(filename, {
                download: true,
                header: true,
                skipEmptyLines: true,
                complete: function(res) {
                    res.data.forEach(row => {
                        if(row.regNo) {
                            row.sgpaNum = parseFloat(row.sgpa) || 0;
                            row.cgpaNum = parseFloat(row.cgpa) || row.sgpaNum;
                            row.sourceFile = filename;
                            allData.push(row);
                        }
                    });
                    resolve(true);
                },
                error: function() { resolve(false); }
            });
        });
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
            <i class="ti ti-folder fs-1 text-muted opacity-50 mb-3"></i>
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
        
        const semName = row.semester || "Unknown";
        row.isEven = isEvenSemester(semName);
        row.displaySgpa = row.isEven ? row.cgpaNum : row.sgpaNum;

        studentMap[regNo].records.push(row);
        
        if (!studentMap[regNo].semesters.includes(semName)) {
            studentMap[regNo].semesters.push(semName);
        }
        
        if(row.fail_any === 'PASS') studentMap[regNo].passCount++;
        
        if(!isNaN(row.displaySgpa) && row.displaySgpa > 0) {
            studentMap[regNo].totalSgpa += row.displaySgpa;
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
            <i class="ti ti-folder fa-4x mb-3 text-secondary opacity-50" style="font-size: 4rem;"></i>
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
        const badgeClass = isPass ? 'bg-green' : 'bg-red';
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

        const card = document.createElement('div');
        card.className = 'col-sm-6 col-lg-4 mb-3';
        
        // Multi-semester badge string
        const semestersText = studentGroup.semesters.length > 1 ? `${studentGroup.semesters.length} Semesters` : `Sem ${studentGroup.semesters[0]}`;

        card.innerHTML = `
            <div class="card card-sm h-100 cursor-pointer card-hover-shadow" onclick="showStudentDetails('${studentGroup.regNo}')">
                <div class="card-status-top ${isPass ? 'bg-green' : 'bg-red'}"></div>
                <div class="card-body">
                    <div class="d-flex align-items-center">
                        <span class="avatar me-3 rounded text-white ${studentGroup.avgSgpa >= 8 ? 'bg-primary' : 'bg-secondary'}">${studentGroup.name ? studentGroup.name.charAt(0) : '?'}</span>
                        <div>
                            <div class="font-weight-medium">${studentGroup.name}</div>
                            <div class="text-muted">${studentGroup.regNo}</div>
                        </div>
                        <div class="ms-auto">
                            <span class="badge ${badgeClass}-lt">${statusText}</span>
                        </div>
                    </div>
                    <div class="mt-3 text-muted small">
                        <div class="text-truncate" title="${studentGroup.course}"><i class="ti ti-book me-1"></i> ${studentGroup.course}</div>
                        <div class="text-truncate mt-1" title="${studentGroup.college_name}"><i class="ti ti-building me-1"></i> ${studentGroup.college_name}</div>
                        <div class="text-truncate mt-1 text-primary"><i class="ti ti-layers me-1"></i> ${semestersText}</div>
                    </div>
                </div>
                <div class="card-footer p-2 text-center bg-transparent border-0 mt-auto">
                    <div class="row row-deck g-0">
                        <div class="col border-end p-2">
                            <div class="text-muted small text-uppercase font-weight-bold">Avg SGPA/CGPA</div>
                            <div class="h3 mb-0 ${studentGroup.avgSgpa >= 8 ? 'text-success' : 'text-primary'}">${studentGroup.avgSgpa.toFixed(2) || 'N/A'}</div>
                        </div>
                        <div class="col p-2">
                            <div class="text-muted small text-uppercase font-weight-bold">Total Marks</div>
                            <div class="h3 mb-0">${totalScore}</div>
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

    paginationList.appendChild(createBtn('<i class="ti ti-chevron-left"></i>', currentPage - 1, currentPage === 1, false));

    // Determine how many page buttons to show based on screen size
    const isMobile = window.innerWidth < 576;
    const windowSize = isMobile ? 3 : 5;
    const halfWindow = Math.floor(windowSize / 2);

    let startPage = Math.max(1, currentPage - halfWindow);
    let endPage = Math.min(totalPages, startPage + windowSize - 1);
    if(endPage - startPage < windowSize - 1) {
        startPage = Math.max(1, endPage - windowSize + 1);
    }

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

    paginationList.appendChild(createBtn('<i class="ti ti-chevron-right"></i>', currentPage + 1, currentPage === totalPages, false));
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
            <div class="accordion-item">
                <h2 class="accordion-header" id="${headingId}">
                    <button class="accordion-button ${idx === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${isExpanded}">
                        <div class="d-flex justify-content-between w-100 pe-3 flex-column flex-sm-row align-items-start align-items-sm-center">
                            <span><i class="ti ti-calendar me-2 text-primary"></i>Semester ${record.semester} <small class="text-muted ms-2 fw-normal">(${record.exam_held || ''})</small></span>
                            <span class="badge ${isSemPass ? 'bg-green' : 'bg-red'} ms-auto mt-2 mt-sm-0">${record.isEven ? 'CGPA' : 'SGPA'}: ${record.displaySgpa.toFixed(2)} - ${isSemPass ? 'PASS' : 'FAIL'}</span>
                        </div>
                    </button>
                </h2>
                <div id="${collapseId}" class="accordion-collapse collapse ${showClass}" data-bs-parent="#semAccordion">
                    <div class="accordion-body pt-0 pb-0">
                        <div class="table-responsive">
                            <table class="table table-vcenter card-table table-striped table-hover mt-3 mb-3">
                                <thead>
                                    <tr>
                                        <th>Code</th>
                                        <th class="subject-name-col">Subject Name</th>
                                        <th class="text-center">Credit</th>
                                        <th class="text-center">ESE <small>(Ext)</small></th>
                                        <th class="text-center">IA <small>(Int)</small></th>
                                        <th class="text-center text-primary">Total</th>
                                        <th class="text-center">Grade</th>
                                    </tr>
                                </thead>
                                <tbody>${subjectsHtml}</tbody>
                                <tfoot class="bg-transparent font-weight-bold">
                                    <tr>
                                        <td colspan="2" class="text-end text-muted text-uppercase">Total:</td>
                                        <td class="text-center">${totalCredits}</td>
                                        <td colspan="2"></td>
                                        <td class="text-center fs-3 text-primary">${grandTotal}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        ${!isSemPass ? `<div class="alert alert-danger m-3 py-2 small fw-bold text-center"><i class="ti ti-alert-triangle me-2"></i> BACKLOG: ${record.fail_any.replace('FAIL:', '')}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    const bodyHtml = `
        <div class="modal-body bg-muted-lt pb-4">
            <div class="row align-items-center">
                <div class="col-md-7 mb-4 mb-md-0">
                    <div class="d-flex align-items-center mb-4">
                        <span class="avatar avatar-xl me-3 rounded text-white ${studentGroup.avgSgpa >= 8 ? 'bg-primary' : 'bg-secondary'}">${studentGroup.name.charAt(0)}</span>
                        <div>
                            <h2 class="mb-1 text-primary">${studentGroup.name}</h2>
                            <div class="text-muted"><i class="ti ti-id me-2"></i>${studentGroup.regNo}</div>
                        </div>
                    </div>
                    <table class="table table-sm table-borderless mb-0">
                        <tr><td class="text-muted w-25 pb-2"><i class="ti ti-user me-2"></i>Father:</td><td class="font-weight-medium pb-2">${studentGroup.father_name}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="ti ti-user-circle me-2"></i>Mother:</td><td class="font-weight-medium pb-2">${studentGroup.mother_name}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="ti ti-book me-2"></i>Course:</td><td class="font-weight-medium pb-2">${studentGroup.course}</td></tr>
                        <tr><td class="text-muted w-25 pb-2"><i class="ti ti-building me-2"></i>College:</td><td class="font-weight-medium pb-2">${studentGroup.college_name}</td></tr>
                    </table>
                </div>
                <div class="col-md-5">
                    <div class="card shadow-sm border-0">
                        <div class="card-body text-center">
                            <div class="text-muted text-uppercase font-weight-bold mb-2">Overall Average SGPA</div>
                            <div class="h1 mb-1 ${studentGroup.avgSgpa >= 8 ? 'text-success' : 'text-primary'}" style="font-size: 3.5rem;">${studentGroup.avgSgpa.toFixed(2)}</div>
                            <div class="text-muted mb-3">ACROSS ${sortedRecords.length} SEMESTERS</div>
                            <div class="badge ${isPass ? 'bg-green' : 'bg-red'} w-100 py-2 fs-4">
                                <i class="ti ${isPass ? 'ti-check' : 'ti-x'} me-1"></i> OVERALL: ${isPass ? 'CLEAR' : 'BACKLOGS PRESENT'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-body pt-4">
            <div class="card-tabs">
                <ul class="nav nav-tabs nav-fill" data-bs-toggle="tabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <a href="#marks" class="nav-link active" data-bs-toggle="tab" aria-selected="true" role="tab"><i class="ti ti-list me-2"></i>Academic History</a>
                    </li>
                    <li class="nav-item" role="presentation">
                        <a href="#chart" class="nav-link" data-bs-toggle="tab" aria-selected="false" role="tab" tabindex="-1" onclick="renderChartForStudent('${studentGroup.regNo}')"><i class="ti ti-chart-line me-2"></i>Performance Chart</a>
                    </li>
                </ul>

                <div class="tab-content">
                    <div class="tab-pane active show" id="marks" role="tabpanel">
                        <div class="accordion" id="semAccordion">
                            ${accordionHtml}
                        </div>
                    </div>

                    <div class="tab-pane" id="chart" role="tabpanel">
                        <div class="card-body p-3 border rounded">
                            <div class="chart-container">
                                <canvas id="performanceChart"></canvas>
                            </div>
                        </div>
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

    const isDark = document.body.getAttribute('data-bs-theme') === 'dark';
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
        const sgpaData = sortedRecords.map(r => r.displaySgpa);
        
        currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Performance (SGPA/CGPA)',
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
                        title: { display: true, text: 'Score', color: textColor, font: { weight: 'bold' } }
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

    collegeFilter.innerHTML = '<option value="">All Colleges</option>';

    Array.from(colleges).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        collegeFilter.appendChild(opt);
    });

    if(currCol && colleges.has(currCol)) {
        collegeFilter.value = currCol;
    }

    updateBranchDropdown();
}

function updateBranchDropdown() {
    const currBranch = branchFilter.value;
    const branches = new Set();
    const selectedCollege = collegeFilter.value;

    allData.forEach(row => {
        if (!selectedCollege || row.college_name === selectedCollege) {
            if(row.course) branches.add(row.course);
        }
    });

    branchFilter.innerHTML = '<option value="">All Branches</option>';

    Array.from(branches).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b; opt.textContent = b;
        branchFilter.appendChild(opt);
    });

    if(currBranch && branches.has(currBranch)) {
        branchFilter.value = currBranch;
    }
}
