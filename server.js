var express = require('express');
var ExpressPeerServer = require('peer').ExpressPeerServer;
var app = express();


app.use(express.static('static'));
app.get('/app', function(req, res) {
    res.sendFile('static/client.html', {root: __dirname});
});

var options = {
    debug: true,
    path: '/'
}

var server = require('http').createServer(app);

app.use('/', ExpressPeerServer(server, options));

server.listen(9000);
