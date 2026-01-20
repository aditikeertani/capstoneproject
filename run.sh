echo "Starting Flask..."
python ./backend/server.py &
sleep 5 #gives Flask time to get up and running
echo "Starting React..."
cd ./frontend
npm start
wait