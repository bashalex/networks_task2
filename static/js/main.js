// Connect to PeerJS
var peer = new Peer(Math.random().toString(36).slice(2), {
  host: '127.0.0.1',
  port: 9000,
  debug: 3
});

var surnames = ['Ivanov', 'Pavlov', 'Sidorov', 'Vasnetsov', 'Petrov', 'Kuznetsov', 'Nikitin', 'Pushkin', 'Lermontov', 'Esenin', 'Bulgakov'];
var names = ['Ivan', 'Petr', 'Aleksei', 'Kirill', 'Sergei', 'Anton', 'Aleksandr', 'Yury'];
var domains = ['google', 'yandex', 'mail', 'rambler', 'yahooo', 'microsoft'];

function choose(choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
}

var surname = choose(surnames);
var name = choose(names);
var email = name + '.' + surname + '@' + choose(domains) + '.com';

var message_map = {};

// Show our info
peer.on('open', function(id){
  $('#pid').text(id);
  $('#name').text(name + ' ' + surname);
  $('#email').text(email);
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

var connections = {};
var successor, predecessor;

var localTable = [];
var fingerTable = new Map();

var fingersToFillLeft = m = 10;
var fingersFilledLocaly = 0;

function hash(key) {
  var number = bigint_from_string(sha1(key), 16);
  return bigint_number(bigint_mod(number, 1024));
}

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

function selectDataToMove(new_peer) {
  var key = hash(new_peer);
  var result = {};
  for (var key_hash in localTable) {
    var old_dist = (Math.pow(2, m) - key_hash + hash(peer.id)) % Math.pow(2, m);
    var new_dist = (Math.pow(2, m) - key_hash + hash(new_peer)) % Math.pow(2, m);
    console.log(key_hash, peer.id, new_peer, old_dist, new_dist);
    if (new_dist < old_dist) {
      result[key_hash] = localTable[key_hash];
      delete localTable[key_hash];
    }
  }
  return result;
}

function insertToLocalTable(key, value) {
  console.log(key, hash(key));
  if (localTable[hash(key)] == undefined) {
    localTable[hash(key)] = [];
  }

  localTable[hash(key)].push({ key: key, value: value});
}

function getFromLocalTable(key) {
  var results = localTable[hash(key)];

  for (var i in results) {
    if (results[i].key == key) return results[i].value;
  }

  return null;
}

function onMsgReceived(sender, data) {
  switch(data.label) {
    case 'lookup':
      var potential_holder = lookup(data.key);
      console.log("find lookup for", data.key, "node", potential_holder);
      if (potential_holder === peer.id) {
        sendMessage(data.initiator, { label: 'lookup_result', key: data.key, intention: data.intention, result: peer.id });
      } else {
        sendMessage(potential_holder, { label: 'lookup', key: data.key, intention: data.intention, initiator: data.initiator });
      }

      break;

    case 'lookup_and_get':
      var potential_holder = lookup(hash(data.key));
      console.log("find and get lookup for", data.key, "node", potential_holder);
      if (potential_holder === peer.id) {
        sendMessage(data.initiator, { label: 'lookup_and_get_result', key: data.key, intention: data.intention, result: getFromLocalTable(data.key) });
      } else {
        sendMessage(potential_holder, { label: 'lookup_and_get', key: data.key, intention: data.intention, initiator: data.initiator });
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
        fingersToFillLeft--;
        fingerTable.set(data.key, data.result);

        if (fingersToFillLeft == 0) {
          // fill local table with own info
          insertToLocalTable(name, peer.id);
          insertToLocalTable(surname, peer.id);
          insertToLocalTable(email, peer.id);

          // find owner for our data
          var potential_holder = lookup(hash(name));
          if (potential_holder != peer.id) {
            sendMessage(potential_holder, { label: 'lookup', key: hash(name), intention: 'insert_entry', initiator: peer.id });
          }
          potential_holder = lookup(hash(surname));
          if (potential_holder != peer.id) {
            sendMessage(potential_holder, { label: 'lookup', key: hash(surname), intention: 'insert_entry', initiator: peer.id });
          }
          potential_holder = lookup(hash(email));
          if (potential_holder != peer.id) {
            sendMessage(potential_holder, { label: 'lookup', key: hash(email), intention: 'insert_entry', initiator: peer.id });
          }
        }
      }

      if (data.intention === 'insert_entry') {
        console.log('ask', data.result, 'to insert', data.key, 'with value', localTable[data.key]);
        sendMessage(sender, { label: 'insert_entry', key: data.key, value: localTable[data.key] });
        delete localTable[data.key];
      }

      break;

    case 'lookup_and_get_result':
      if (data.intention === 'send_msg') {
        if (data.result !== null) {
          sendMessage(data.result, {label: 'private_messages', messages: message_map[hash(data.key)]});
          delete message_map[hash(data.key)];
        } else {
          $('#messages').append('<span class="filler">' + 'Attempt to send private message failed because no such user exists' + '</span>');
        }
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
      var dataToMove = selectDataToMove(sender);
      sendMessage(sender, { label: 'notify_new_peer_about_predecessor' , 'predecessor': old_predecessor,  'data': dataToMove });
      break;

    case 'notify_predecessor':
      console.log('successor updated from', successor, 'to', data.new_peer);
      successor = data.new_peer;
      break;

    case 'notify_new_peer_about_predecessor':
      console.log('predecessor updated from', predecessor, 'to', data.predecessor);
      predecessor = data.predecessor;

      // update local table
      for (var index in data.data) {
        localTable[index] = data.data[index];
      }

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

    case 'insert_entry':
      console.log('insert key', data.key, 'with value', data.value);
      for (var i in data.value) {
         insertToLocalTable(data.value[i].key, data.value[i]);
      }

      break;

    case 'private_messages':
      console.log('messages received: ', data.messages);
      for (var index in data.messages) {
        $('#messages').append('<span class="filler">' + 'Personal Message from ' + sender + ': ' + data.messages[index] + '</span>');
      }
      break;

    case 'public_message':
      console.log("public message recieved");
      if (successor != data.initiator) {
        sendMessage(successor, data);
      }

      $('#messages').append('<span class="filler">' + 'Public Message from ' + sender + ': ' + data.message + '</span>');

      break;

    case 'pred_dies':
      console.log('predecessor dies', sender);

      predecessor = data.predecessor;
      sendMessage(successor, { label: 'update_fingers_del', deleted_peer: sender, new_holder: peer.id });

      for (i in data.data) {
        for (j in data.data[i]) {
          insertToLocalTable(data.data[i][j].key, data.data[i][j].value);
        }
      }

      fixFingersDel(sender, peer.id);
      break;

    case 'update_fingers_del':
      console.log("updating own fingers because of delete of node");
      console.log(peer.id, data.deleted_peer, data.new_holder, successor);
      if (successor != data.deleted_peer && successor != peer.id && successor != data.new_holder) {
        sendMessage(successor, data);
      } else if (successor == data.deleted_peer) {
        console.log("update successor from", successor, "to", data.new_holder)
        successor = data.new_holder;
      }

      fixFingersDel(data.deleted_peer, data.new_holder);
      break;
  }
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

function fixFingersDel(deleted_peer, new_holder) {
  for (var i = 0; i < m; i += 1) {
    var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
    console.log("Try update", key_hash, "from", fingerTable.get(key_hash), "because deleted", deleted_peer);
    if (fingerTable.get(key_hash) == deleted_peer) {
      console.log('Update finger', key_hash, 'from', deleted_peer, 'to', new_holder);
      fingerTable.set(key_hash, new_holder);
    }
  }
}

function fillFingerTable() {
  for (var i = 0; i < m; i += 1) {
    var key_hash = (hash(peer.id) + Math.pow(2, i)) % Math.pow(2, m);
    if ((hash(peer.id) > hash(successor) && (key_hash > hash(peer.id) || key_hash <= hash(successor)))
      || (hash(peer.id) < hash(successor) && (key_hash > hash(peer.id) && key_hash <= hash(successor)))) {
      console.log('Set 1', key_hash, 'to', successor);
      fingersToFillLeft--;
      fingersFilledLocaly++;
      fingerTable.set(key_hash, successor);
    } else if ((hash(predecessor) > hash(peer.id) && (key_hash > hash(predecessor) || key_hash <= hash(peer.id)))
      || (hash(predecessor) < hash(peer.id) && (key_hash > hash(predecessor) && key_hash <= hash(peer.id)))) {
      console.log('Set 2', key_hash, 'to', peer.id);
      fingersToFillLeft--;
      fingersFilledLocaly++;
      fingerTable.set(key_hash, peer.id);
    } else {
      sendMessage(successor, { label: 'lookup', key: key_hash, intention: 'find_finger', initiator: peer.id });
    }
  }

  if (fingersFilledLocaly === m) {
    // fill local table with own info
    insertToLocalTable(name, peer.id);
    insertToLocalTable(surname, peer.id);
    insertToLocalTable(email, peer.id);

    // find owner for our data
    var potential_holder = lookup(hash(name));
    if (potential_holder != peer.id) {
      sendMessage(potential_holder, { label: 'lookup', key: hash(name), intention: 'insert_entry', initiator: peer.id });
    }
    potential_holder = lookup(hash(surname));
    if (potential_holder != peer.id) {
      sendMessage(potential_holder, { label: 'lookup', key: hash(surname), intention: 'insert_entry', initiator: peer.id });
    }
    potential_holder = lookup(hash(email));
    if (potential_holder != peer.id) {
      sendMessage(potential_holder, { label: 'lookup', key: hash(email), intention: 'insert_entry', initiator: peer.id });
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

    // fill local table with own info
    insertToLocalTable(name, peer.id);
    insertToLocalTable(surname, peer.id);
    insertToLocalTable(email, peer.id);
  });

  $('#log_table').click(function() {
    console.log('Local Table:');
    for (var i in localTable) {
      console.log(localTable[i]);
    }
  });

  $('#send_message').click(function() {
     $('#messages').append('<div><span class="you">You: </span>' + msg
          + '</div>');
  });

  $('#send').submit(function(e) {
    e.preventDefault();
    var msg = $('#text').val();

    if (msg.startsWith('@')) {
      var name = msg.slice(1, msg.indexOf(' '));
      var potential_holder = lookup(hash(name));
      if (potential_holder != peer.id) {
        if (message_map[hash(name)] == undefined) {
          message_map[hash(name)] = [];
        }
        message_map[hash(name)].push(msg.slice(msg.indexOf(' ')));
        sendMessage(potential_holder, { label: 'lookup_and_get', key: name, intention: 'send_msg', initiator: peer.id });
      } else {
        var recepient = getFromLocalTable(name);
        sendMessage(recepient, {label: 'private_messages', messages: [msg.slice(msg.indexOf(' '))]});
      }
      $('#messages').append('<span class="filler">' + 'Personal Message to ' + name + ': ' + msg.slice(msg.indexOf(' ')) + '</span>');
    } else {
      sendMessage(successor, {label: 'public_message', message: msg, initiator: peer.id});
      $('#messages').append('<span class="filler">' + 'Broadcast: ' + msg + '</span>');
    }
  });

});

// Make sure things clean up properly.
window.onbeforeunload = function(e) {
  sendMessage(successor, {label: 'pred_dies', data: localTable, predecessor: predecessor});

};

window.onunload = function(e) {
  if (!!peer && !peer.destroyed) {
    peer.destroy();
  }
};

