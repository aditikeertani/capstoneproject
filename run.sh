echo "Starting MongoDB..."
mongod --dbpath ./backend/db &
sleep 5 #gives Mongo time to get up and running
echo "Starting Flask..."
python ./backend/server.py &
sleep 5 #gives Flask time to get up and running
echo "Starting React..."
cd ./frontend
npm start
wait