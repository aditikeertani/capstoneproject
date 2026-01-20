mongod --dbpath ./backend/db &
sleep 5 #gives Mongo time to get up and running
python ./backend/server.py &
sleep 5 #gives Flask time to get up and running
cd ./frontend
npm start
wait