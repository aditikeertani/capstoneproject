#!/bin/bash

mkdir -p backend/db

echo "Starting MongoDB..."
mongod --dbpath ./backend/db &
sleep 5

echo "Starting Flask..."
(cd backend && source venv/bin/activate && python server.py) &
sleep 5

echo "Starting React..."
cd frontend
npm start

wait