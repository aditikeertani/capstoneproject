# Mongo Guide

## Things to install
- [mongod](https://www.mongodb.com/try/download/community) (in the dropdown, set "package" equal to "server")
- [mongosh](https://www.mongodb.com/try/download/shell) (optional, for interacting directly with the database via the command line)

## Helpful links
- [How to start a MongoDB local server](https://www.geeksforgeeks.org/mongodb/how-to-start-mongodb-local-server/)
- [PyMongo With Flask](https://flask-pymongo.readthedocs.io/en/latest/)

## Other
We are working with the idea that our database will be in a directory inside of backend called 'db', so when launching mongod, it will launch as
`mongod --dbpath /backend/db`
