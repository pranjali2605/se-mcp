const express = require("express");
const studentService = require("./studentService");

const app = express();
app.use(express.json());

app.get("/students", (req, res) => res.json(studentService.list()));

app.get("/students/:id", (req, res) => {
  const s = studentService.findById(Number(req.params.id));
  if (!s) return res.status(404).json({ error: "not found" });
  res.json(s);
});

app.post("/students", (req, res) => {
  try {
    res.status(201).json(studentService.add(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// TODO: add authentication middleware
app.listen(3000, () => console.log("Student API listening on 3000"));
