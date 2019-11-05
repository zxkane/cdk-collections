'use strict';

const mysql = require('mysql');

const connection = mysql.createConnection({
    host: process.env.HOST,
    user: process.env.USERNAME,
    password: process.env.PASSWORD,
    database: 'mysql',
});
const queries = [
    'show tables',
    'select * from time_zone_name',
    'select Name,Time_zone_id from time_zone_name limit 1',
    'delete from time_zone_name where Name=\'Asia\''
];
exports.handler = (event, context, callback) => {
    connection.query(queries[Math.floor(Math.random()*queries.length)], function (error, results, fields) {
        if (error) {
            connection.destroy();
            throw error;
        } else {
            // connected!
            console.log(results);
            callback(error, results);
            connection.end(function (err) { callback(err, results);});
        }
    });
};