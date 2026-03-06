import requests
import json
import csv
import time

def fetch_data():
    base_url = "https://beu-bih.ac.in/backend/v1/result/get-result"

    all_student_data = []
    all_subject_columns = set()

    start_reg = 24110113001
    end_reg = 24110113060

    # We create a session to reuse connections and be faster
    session = requests.Session()

    for reg_no in range(start_reg, end_reg + 1):
        params = {
            "year": "2024",
            "redg_no": str(reg_no),
            "semester": "I",
            "exam_held": "May/2025"
        }

        try:
            response = session.get(base_url, params=params)
            response.raise_for_status()
            data = response.json()

            if data.get("status") == 200 and data.get("data"):
                student_info = data["data"]

                # Basic info
                processed_student = {
                    "regNo": student_info.get("redg_no"),
                    "name": student_info.get("name"),
                    "father_name": student_info.get("father_name"),
                    "mother_name": student_info.get("mother_name"),
                    "college_code": student_info.get("college_code"),
                    "college_name": student_info.get("college_name"),
                    "course_code": student_info.get("course_code"),
                    "course": student_info.get("course"),
                    "semester": student_info.get("semester"),
                    "exam_held": student_info.get("exam_held"),
                    "examYear": student_info.get("examYear"),
                    "sgpa": student_info.get("sgpa", [None])[0] if student_info.get("sgpa") else None,
                    "cgpa": student_info.get("cgpa"),
                    "fail_any": student_info.get("fail_any")
                }

                # Theory Subjects
                for subject in student_info.get("theorySubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"{sub_name}_code"] = subject.get("code")
                        processed_student[f"{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"{sub_name}_total"] = subject.get("total")
                        processed_student[f"{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"{sub_name}_credit"] = subject.get("credit")

                        all_subject_columns.add(f"{sub_name}_code")
                        all_subject_columns.add(f"{sub_name}_ese")
                        all_subject_columns.add(f"{sub_name}_ia")
                        all_subject_columns.add(f"{sub_name}_total")
                        all_subject_columns.add(f"{sub_name}_grade")
                        all_subject_columns.add(f"{sub_name}_credit")

                # Practical Subjects
                for subject in student_info.get("practicalSubjects", []):
                    sub_name = subject.get("name")
                    if sub_name:
                        processed_student[f"{sub_name}_code"] = subject.get("code")
                        processed_student[f"{sub_name}_ese"] = subject.get("ese")
                        processed_student[f"{sub_name}_ia"] = subject.get("ia")
                        processed_student[f"{sub_name}_total"] = subject.get("total")
                        processed_student[f"{sub_name}_grade"] = subject.get("grade")
                        processed_student[f"{sub_name}_credit"] = subject.get("credit")

                        all_subject_columns.add(f"{sub_name}_code")
                        all_subject_columns.add(f"{sub_name}_ese")
                        all_subject_columns.add(f"{sub_name}_ia")
                        all_subject_columns.add(f"{sub_name}_total")
                        all_subject_columns.add(f"{sub_name}_grade")
                        all_subject_columns.add(f"{sub_name}_credit")

                all_student_data.append(processed_student)
                print(f"Successfully fetched data for {reg_no}")
            else:
                print(f"Failed or no data for {reg_no}: {data.get('message')}")
        except Exception as e:
            print(f"Error fetching data for {reg_no}: {e}")

        # Optional small sleep to be nice to the server
        time.sleep(0.1)

    # Write to CSV
    basic_columns = [
        "regNo", "name", "father_name", "mother_name",
        "college_code", "college_name", "course_code", "course",
        "semester", "exam_held", "examYear", "sgpa", "cgpa", "fail_any"
    ]

    # Sort subject columns for consistent ordering
    sorted_subject_columns = sorted(list(all_subject_columns))

    all_columns = basic_columns + sorted_subject_columns

    # Check if there is any data
    if not all_student_data:
        print("No student data was collected.")
        return

    with open('student_marks.csv', 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=all_columns)
        writer.writeheader()
        for row in all_student_data:
            # Only write fields that exist in all_columns (which should be all of them)
            # using writerow directly expects all keys in row to be in fieldnames,
            # which is true here because we add all subjects to all_subject_columns
            writer.writerow(row)

    print(f"Data extracted to student_marks.csv with {len(all_student_data)} records.")

if __name__ == "__main__":
    fetch_data()
