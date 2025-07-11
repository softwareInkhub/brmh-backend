const express = require('express');
const app = express();
const User = require('../models/User');

app.get('/users', (req, res) => {
  // TODO: Implement Get all users
  res.json({ message: 'Get all users' });
});

app.post('/users', (req, res) => {
  // TODO: Implement Create a new user
  res.json({ message: 'Create a new user' });
});

module.exports = app;
