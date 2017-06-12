// Connect to PeerJS, have server assign an ID instead of providing one
// Showing off some of the configs available with PeerJS :).
var peer = new Peer(Math.random().toString(36).slice(2), {
  host: '127.0.0.1',
  port: 9000,
  debug: 3
});

var connections = {}

function sendMessage(peer_id, message) {
  console.log("SEND", message.label, "to", peer_id);

  if (connections[peer_id] != undefined && connections[peer_id].conn.open) {
    connections[peer_id].conn.send(message);
    return;
  }

  if (connections[peer_id] == undefined) {
    console.log("create new connection");
    var new_connection = peer.connect(peer_id, {
      serialization: 'json'
    });

    connections[peer_id] = {conn: new_connection, links: 1, message_queue: []};

    connections[peer_id].conn.on('data', function(data) {
      onMsgReceived(peer_id, data)
    });

    connections[peer_id].conn.on('open', function() {
      console.log("connection opened, sending messages from queue");
      while (connections[peer_id].message_queue.length != 0) {        
        var msg = connections[peer_id].message_queue.shift();
        console.log("message from queue", msg);
        connections[peer_id].conn.send(msg);
      }
    });

    connections[peer_id].conn.on('close', function() {
      delete connections[peer_id];
    });
  }

  if (connections[peer_id].conn.open) {
    connections[peer_id].conn.send(message);
  } else {
    connections[peer_id].message_queue.push(message);
  }
}

// Show this peer's ID.
peer.on('open', function(id){
  $('#pid').text(id);
});


// Await connections from others
peer.on('connection', function(conn) {
  connections[conn.peer] = {conn: conn, links: 1, message_queue: []}
  conn.on('data', function(data) {
    onMsgReceived(conn.peer, data);
  });
});

peer.on('error', function(err) {
  console.log(err);
})

var successor, predecessor;
var fingerTable = new Map();
var m = 10;

function lookup(key) {
  if ((hash(predecessor) > hash(peer.id) && (key > hash(predecessor) || key <= hash(peer.id)))
    || (hash(predecessor) < hash(peer.id) && (key > hash(predecessor) && key <= hash(peer.id)))) {
    console.log('lookup returns', peer.id, 'for', key);
    return peer.id;
  }
  var min_dist = Math.pow(2, m);
  var res = 0;
  for (var i = m - 1; i >= 0; i -= 1) {
    var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
    var dist = (Math.pow(2, m) - key_hash + key) % Math.pow(2, m);
    if (dist < min_dist) {
      min_dist = dist;
      res = key_hash;
    }
  }
  console.log('lookup returns', fingerTable.get(res), 'for', key);
  return fingerTable.get(res);
}

// function insertInDHT(key, value) {
//  var hash = 
// }


function onMsgReceived(sender, data) {
  switch(data.label) {
    case 'lookup':
      var potential_holder = lookup(data.key);
      console.log("find lookup for", data.key, "node", potential_holder);
      if (potential_holder === peer.id) {
        sendMessage(data.initiator, { label: 'lookup_result', key: data.key, intention: data.intention, result: peer.id });
      } else {
        sendMessage(potential_holder, { label: 'lookup', key: data.key, initiator: data.initiator, intention: data.intention });
      }

      break;

    case 'lookup_result':
      console.log("lookup result for", data.key, "with intention", data.intention, "is", data.result);
      if (data.intention === 'find_successor') {
        successor = data.result;
        sendMessage(successor, { label: 'notify_successor' });
      }
      if (data.intention === 'find_finger') {
        console.log("update finger", data.key, "with", data.result);
        fingerTable.set(data.key, data.result);
      }
      break;

    case 'notify_successor':
      var old_predecessor = predecessor;

      console.log('predecessor updated from', old_predecessor, 'to', sender);
      predecessor = sender;

      if (old_predecessor != peer.id) {
        sendMessage(old_predecessor, { label: 'notify_predecessor', new_peer: sender });
      } else {
        successor = sender;
      }

      sendMessage(sender, { label: 'notify_new_peer_about_predecessor' , 'predecessor': old_predecessor });
      break;

    case 'notify_predecessor':
      console.log('successor updated from', successor, 'to', data.new_peer);
      successor = data.new_peer;
      break;

    case 'notify_new_peer_about_predecessor':
      console.log('predecessor updated from', predecessor, 'to', data.predecessor);
      predecessor = data.predecessor;
      sendMessage(successor, { label: 'update_fingers', new_peer: peer.id });
      break;

    case 'update_fingers':
      console.log("updating own fingers");
      var new_peer = data.new_peer;
      if (successor != new_peer) {
        sendMessage(successor, data);
      }

      fixFingers(new_peer);

      if (successor == new_peer) {
        sendMessage(successor, { label: 'fingers_update_finished'});
      }
      break;

    case 'fingers_update_finished':
      console.log("creating own fingers");
      fillFingerTable();
      break;
  }
}

function hash(key) {
  var number = bigint_from_string(sha1(key), 16);
  return bigint_number(bigint_mod(number, 1024));
}

function fixFingers(new_peer) {
  for (var i = 0; i < m; i += 1) {
    var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
    var old_finger = fingerTable.get(key_hash);
    var old_dist = (Math.pow(2, m) - key_hash + hash(old_finger)) % Math.pow(2, m);
    var new_dist = (Math.pow(2, m) - key_hash + hash(new_peer)) % Math.pow(2, m);
    console.log('Check fingers for', key_hash, '. Old:', old_finger, ', New:', new_peer);
    if (new_dist < old_dist) {
      console.log('Update finger', key_hash, 'from', old_finger, 'to', new_peer);
      fingerTable.set(key_hash, new_peer);
    }
  }
}

function fillFingerTable() {
  for (var i = 0; i < m; i += 1) {
    var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
    if ((hash(peer.id) > hash(successor) && (key_hash > hash(peer.id) || key_hash <= hash(successor)))
      || (hash(peer.id) < hash(successor) && (key_hash > hash(peer.id) && key_hash <= hash(successor)))) {
      console.log('Set 1', key_hash, 'to', successor);
      fingerTable.set(key_hash, successor);
    } else if ((hash(predecessor) > hash(peer.id) && (key_hash > hash(predecessor) || key_hash <= hash(peer.id)))
      || (hash(predecessor) < hash(peer.id) && (key_hash > hash(predecessor) && key_hash <= hash(peer.id)))) {
      console.log('Set 2', key_hash, 'to', peer.id);
      fingerTable.set(key_hash, peer.id);
    } else {
      sendMessage(successor, { label: 'lookup', key: key_hash, intention: 'find_finger', initiator: peer.id });
    }
  }
}

$(document).ready(function() {

  // Connect to a peer
  $('#connect').click(function() {
    var requestedPeer = $('#rid').val();
    sendMessage(requestedPeer, { label: 'lookup', key: hash(peer.id), intention: 'find_successor', initiator: peer.id });
  });

  $('#init').click(function() {
    successor = peer.id;
    predecessor = peer.id;

    console.log('My hash:', hash(peer.id));
    for (var i = 0; i < m; i += 1) {
      var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
      console.log('Set', key_hash, 'to', peer.id);
      fingerTable.set(key_hash, peer.id);
    }
  });

});

// Make sure things clean up properly.
window.onunload = window.onbeforeunload = function(e) {
  if (!!peer && !peer.destroyed) {
    peer.destroy();
  }
};
