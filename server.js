const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const players = {};

io.on('connection', (socket) => {
  console.log('a user connected: ' + socket.id);

  // Broadcast new player to others
  // socket.broadcast.emit('newPlayer', { ... }); // Moved to join event

  socket.on('playerJoin', (username) => {
    // Ensure unique name
    let finalName = username || "Player";
    let count = 1;
    while (Object.values(players).some(p => p.username === finalName)) {
      finalName = `${username}${count}`;
      count++;
    }

    // Initialize new player
    players[socket.id] = {
      x: 0,
      y: 1, // Start slightly above ground
      z: 0,
      color: Math.random() * 0xffffff,
      username: finalName
    };

    console.log(`${finalName} joined the game.`);

    // Send current players to new player
    socket.emit('currentPlayers', players);

    // Ack join with assigned name
    socket.emit('joinSuccess', { id: socket.id, username: finalName, x: 0, y: 1, z: 0 });

    // Broadcast new player to others
    socket.broadcast.emit('newPlayer', {
      id: socket.id,
      player: players[socket.id]
    });
  });

  // Handle movement updates
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].z = movementData.z;

      // Emit connection update to all other players
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: players[socket.id].x,
        y: players[socket.id].y,
        z: players[socket.id].z
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected: ' + socket.id);
    if (players[socket.id]) {
      console.log(`${players[socket.id].username} left.`);
      delete players[socket.id];
      io.emit('disconnectPlayer', socket.id);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
