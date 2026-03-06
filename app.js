let allData = [];
let filteredData = [];
const rowsPerPage = 12;
let currentPage = 1;

// Elements
const searchInput = document.getElementById('searchInput');
const collegeFilter = document.getElementById('collegeFilter');
const branchFilter = document.getElementById('branchFilter');
const searchBtn = document.getElementById('searchBtn');
const resultsArea = document.getElementById('resultsArea');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const totalRecords = document.getElementById('totalRecords');
const paginationNav = document.getElementById('paginationNav');
const paginationList = document.getElementById('paginationList');
const studentModal = new bootstrap.Modal(document.getElementById('studentModal'));

document.addEventListener('DOMContentLoaded', () => {
    loadCSVData();

    // Event listeners
    searchBtn.addEventListener('click', applyFilters);
    searchInput.addEventListener('keyup', (e) => {
        if(e.key === 'Enter') applyFilters();
    });
    collegeFilter.addEventListener('change', applyFilters);
    branchFilter.addEventListener('change', applyFilters);
});

function loadCSVData() {
    loading.classList.remove('d-none');

    Papa.parse('all_student_marks.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            allData = results.data;
            totalRecords.textContent = allData.length;

            // Populate filters
            populateFilters();

            // Initial render
            filteredData = [...allData];
            renderPage(1);

            loading.classList.add('d-none');
        },
        error: function(err) {
            loading.classList.add('d-none');
            showError("Could not load database file. Please ensure 'all_student_marks.csv' is generated.");
        }
    });
}

function populateFilters() {
    const colleges = new Set();
    const branches = new Set();

    allData.forEach(row => {
        if(row.college_name) colleges.add(row.college_name);
        if(row.course) branches.add(row.course);
    });

    // Sort and add to DOM
    Array.from(colleges).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        collegeFilter.appendChild(opt);
    });

    Array.from(branches).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        branchFilter.appendChild(opt);
    });
}

function applyFilters() {
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

    currentPage = 1;
    renderPage(1);
}

function renderPage(page) {
    currentPage = page;
    resultsArea.innerHTML = '';

    if(filteredData.length === 0) {
        resultsArea.innerHTML = `<div class="col-12 text-center py-5 text-muted"><i class="fas fa-folder-open fa-3x mb-3 text-light"></i><br>No results found matching your criteria.</div>`;
        paginationNav.style.display = 'none';
        return;
    }

    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedItems = filteredData.slice(start, end);

    paginatedItems.forEach((student, index) => {
        const isPass = student.fail_any === 'PASS';
        const badgeClass = isPass ? 'pass-status' : 'fail-status';
        const statusText = isPass ? 'PASS' : 'FAIL';

        // Calculate total score roughly by finding _total keys with numbers
        let totalScore = 0;
        let maxScore = 0;

        Object.keys(student).forEach(key => {
            if(key.endsWith('_total') && student[key]) {
                totalScore += parseInt(student[key] || 0);
            }
        });

        const card = document.createElement('div');
        card.className = 'col-lg-4 col-md-6 mb-4';
        card.innerHTML = `
            <div class="card h-100 border-0 shadow-sm student-card position-relative" style="cursor: pointer;" onclick="showStudentDetails('${student.regNo}')">
                <span class="status-badge ${badgeClass} fw-bold"><i class="fas ${isPass ? 'fa-check-circle' : 'fa-times-circle'} me-1"></i>${statusText}</span>
                <div class="card-body pt-4">
                    <div class="d-flex align-items-center mb-3">
                        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold me-3 shadow-sm" style="width: 50px; height: 50px; font-size: 1.2rem;">
                            ${student.name ? student.name.charAt(0) : '?'}
                        </div>
                        <div>
                            <h5 class="card-title mb-0 fw-bold text-dark text-truncate" style="max-width: 200px;" title="${student.name}">${student.name}</h5>
                            <small class="text-muted"><i class="fas fa-id-card me-1"></i>${student.regNo}</small>
                        </div>
                    </div>

                    <div class="small mb-3 text-muted">
                        <div class="text-truncate mb-1" title="${student.course}"><i class="fas fa-book me-2"></i>${student.course}</div>
                        <div class="text-truncate" title="${student.college_name}"><i class="fas fa-university me-2"></i>${student.college_name}</div>
                    </div>

                    <div class="d-flex justify-content-between align-items-center border-top pt-3 mt-auto">
                        <div class="text-center">
                            <span class="d-block small text-muted text-uppercase fw-bold" style="font-size: 0.7rem;">SGPA</span>
                            <span class="fs-5 fw-bold text-primary">${parseFloat(student.sgpa).toFixed(2) || 'N/A'}</span>
                        </div>
                        <div class="text-center">
                            <span class="d-block small text-muted text-uppercase fw-bold" style="font-size: 0.7rem;">Total Marks</span>
                            <span class="fs-5 fw-bold text-dark">${totalScore}</span>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-outline-primary rounded-pill px-3">View <i class="fas fa-arrow-right ms-1"></i></button>
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
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    paginationList.innerHTML = '';

    if (totalPages <= 1) {
        paginationNav.style.display = 'none';
        return;
    }

    paginationNav.style.display = 'block';

    // Prev
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `<a class="page-link" href="#" onclick="event.preventDefault(); renderPage(${currentPage - 1})">Previous</a>`;
    paginationList.appendChild(prevLi);

    // Page numbers (simplified, max 5 pages visible)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if(endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for(let i = startPage; i <= endPage; i++) {
        const li = document.createElement('li');
        li.className = `page-item ${currentPage === i ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#" onclick="event.preventDefault(); renderPage(${i})">${i}</a>`;
        paginationList.appendChild(li);
    }

    // Next
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `<a class="page-link" href="#" onclick="event.preventDefault(); renderPage(${currentPage + 1})">Next</a>`;
    paginationList.appendChild(nextLi);
}

// Ensure the student details modal function is accessible globally
window.showStudentDetails = function(regNo) {
    const student = allData.find(s => s.regNo === regNo);
    if(!student) return;

    document.getElementById('modalTitle').textContent = `${student.name} - Result Details`;

    const isPass = student.fail_any === 'PASS';

    // Find all subjects
    const subjects = [];
    const subjectNames = new Set();

    // Extract unique subject names by looking at keys ending with _code or _total
    Object.keys(student).forEach(key => {
        if(key.endsWith('_code')) {
            const name = key.replace('_code', '');
            subjectNames.add(name);
        }
    });

    subjectNames.forEach(name => {
        if(student[`${name}_code`]) {
            subjects.push({
                name: name,
                code: student[`${name}_code`],
                ese: student[`${name}_ese`] || '-',
                ia: student[`${name}_ia`] || '-',
                total: student[`${name}_total`] || '-',
                grade: student[`${name}_grade`] || '-',
                credit: student[`${name}_credit`] || '-'
            });
        }
    });

    // Sort subjects by code
    subjects.sort((a,b) => a.code.localeCompare(b.code));

    let subjectsHtml = '';
    subjects.forEach(sub => {
        // Handle grade color class
        let gClass = 'grade-P';
        if(sub.grade === 'O' || sub.grade === 'A+') gClass = 'grade-O';
        else if(sub.grade === 'A') gClass = 'grade-A';
        else if(sub.grade === 'B') gClass = 'grade-B';
        else if(sub.grade === 'C') gClass = 'grade-C';
        else if(sub.grade === 'D') gClass = 'grade-D';
        else if(sub.grade === 'F') gClass = 'grade-F';

        subjectsHtml += `
            <tr>
                <td class="text-muted">${sub.code}</td>
                <td class="fw-bold">${sub.name}</td>
                <td class="text-center">${sub.credit}</td>
                <td class="text-center">${sub.ese}</td>
                <td class="text-center">${sub.ia}</td>
                <td class="text-center fw-bold">${sub.total}</td>
                <td class="text-center"><span class="grade-box ${gClass}">${sub.grade}</span></td>
            </tr>
        `;
    });

    const bodyHtml = `
        <div class="modal-header-info p-4">
            <div class="row">
                <div class="col-md-6 mb-3 mb-md-0">
                    <div class="d-flex align-items-center mb-3">
                        <div class="bg-white text-primary rounded border border-primary d-flex align-items-center justify-content-center fw-bold me-3 shadow-sm" style="width: 60px; height: 60px; font-size: 1.5rem;">
                            ${student.name.charAt(0)}
                        </div>
                        <div>
                            <h4 class="mb-0 fw-bold text-dark">${student.name}</h4>
                            <div class="text-muted"><i class="fas fa-id-card me-1"></i> ${student.regNo}</div>
                        </div>
                    </div>
                    <table class="table table-sm table-borderless mb-0">
                        <tr><td class="text-muted w-25">Father:</td><td class="fw-bold">${student.father_name}</td></tr>
                        <tr><td class="text-muted w-25">Mother:</td><td class="fw-bold">${student.mother_name}</td></tr>
                        <tr><td class="text-muted w-25">Course:</td><td class="fw-bold">${student.course}</td></tr>
                    </table>
                </div>
                <div class="col-md-6 border-start border-2 border-white pl-md-4">
                    <table class="table table-sm table-borderless mb-2">
                        <tr><td class="text-muted w-25">College:</td><td class="fw-bold">${student.college_name}</td></tr>
                        <tr><td class="text-muted w-25">Semester:</td><td class="fw-bold">${student.semester} (${student.exam_held})</td></tr>
                        <tr><td class="text-muted w-25">Exam Year:</td><td class="fw-bold">${student.examYear}</td></tr>
                    </table>

                    <div class="d-flex mt-3 gap-3">
                        <div class="p-3 bg-white rounded shadow-sm text-center flex-fill border-bottom border-4 border-primary">
                            <span class="d-block small text-muted fw-bold">SGPA</span>
                            <span class="fs-4 fw-bold text-primary">${parseFloat(student.sgpa).toFixed(2)}</span>
                        </div>
                        <div class="p-3 bg-white rounded shadow-sm text-center flex-fill border-bottom border-4 ${isPass ? 'border-success' : 'border-danger'}">
                            <span class="d-block small text-muted fw-bold">Status</span>
                            <span class="fs-4 fw-bold ${isPass ? 'text-success' : 'text-danger'}">${isPass ? 'PASS' : 'FAIL'}</span>
                        </div>
                    </div>
                </div>
            </div>
            ${!isPass ? `<div class="mt-3 alert alert-danger py-2 small mb-0"><i class="fas fa-exclamation-triangle me-2"></i> ${student.fail_any}</div>` : ''}
        </div>

        <div class="p-4">
            <h5 class="fw-bold mb-3 text-secondary border-bottom pb-2"><i class="fas fa-list-alt me-2"></i>Subject Marks</h5>
            <div class="table-responsive">
                <table class="table table-hover table-custom align-middle">
                    <thead>
                        <tr>
                            <th width="10%">Code</th>
                            <th width="40%">Subject Name</th>
                            <th width="10%" class="text-center">Credit</th>
                            <th width="10%" class="text-center">ESE</th>
                            <th width="10%" class="text-center">IA</th>
                            <th width="10%" class="text-center">Total</th>
                            <th width="10%" class="text-center">Grade</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${subjectsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById('modalBody').innerHTML = bodyHtml;
    studentModal.show();
}

function showError(msg) {
    errorText.textContent = msg;
    errorMsg.classList.remove('d-none');
}
