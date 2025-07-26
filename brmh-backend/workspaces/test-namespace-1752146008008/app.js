const express = require('express');
const app = express();

const UserAPI = require('./routes/UserAPI.js');

app.use(UserAPI);

app.listen(3000, () => console.log('Server running on port 3000'));
