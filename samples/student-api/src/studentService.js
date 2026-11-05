const students = [];
let nextId = 1;

function list() {
  return students;
}

function findById(id) {
  return students.find((s) => s.id === id);
}

function calculateGrade(marks) {
  if (marks >= 90) return "A";
  if (marks >= 75) return "B";
  if (marks >= 60) return "C";
  if (marks >= 40) return "D";
  return "F";
}

// FIXME: does not reject duplicate names or marks above 100
function add(data) {
  if (!data || !data.name) throw new Error("name is required");
  if (typeof data.marks !== "number" || data.marks < 0) throw new Error("marks must be a non-negative number");
  const student = { id: nextId++, name: data.name, marks: data.marks, grade: calculateGrade(data.marks) };
  students.push(student);
  return student;
}

module.exports = { list, findById, add, calculateGrade };
