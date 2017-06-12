/*

Setup connection and init random variables

*/
var peer = new Peer(Math.random().toString(36).slice(2), {
  host: '127.0.0.1',
  port: 9000,
  debug: 1
});

var surnames = ['Ivanov', 'Pavlov', 'Sidorov', 'Vasnetsov', 'Petrov', 'Kuznetsov', 'Nikitin', 'Pushkin', 'Lermontov', 'Esenin', 'Bulgakov'];
var names = ['Ivan', 'Petr', 'Aleksei', 'Kirill', 'Sergei', 'Anton', 'Aleksandr', 'Yury'];
var domains = ['google', 'yandex', 'mail', 'rambler', 'yahooo', 'microsoft'];

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

// Make sure things clean up properly.
window.onbeforeunload = function(e) {
  sendMessage(successor, {label: 'predcessor_leaving', data: localTable, predecessor: predecessor});

};

window.onunload = function(e) {
  if (!!peer && !peer.destroyed) {
    peer.destroy();
  }
};


/*

DATA

*/

var connections = {};
var successor, predecessor;

var localTable = [];
var fingerTable = new Map();

var fingersToFillLeft = m = 10;
var fingersFilledLocaly = 0;

/*

Util Functions

*/

function choose(choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
}

function hash(key) {
  var number = bigint_from_string(sha1(key), 16);
  return bigint_number(bigint_mod(number, 1024));
}

function distance(from, to) {
  return (Math.pow(2, m) - from + to) % Math.pow(2, m);
}

function fingerHash(idx) {
  return (hash(peer.id) + Math.pow(2, idx)) % Math.pow(2, m);
}

function isBetweenClockwise(value, left, right) {
  return distance(left, right) >= distance(left, value);
}

function findClosest(key) {
  var min_dist = Math.pow(2, m);
  var result = 0;
  for (var i = m - 1; i >= 0; i -= 1) {
    var key_hash = fingerHash(i);
    if (distance(key_hash, key) < min_dist) {
      min_dist = distance(key_hash, key);
      result = key_hash;
    }
  }
  return result;
}

/*

Main Functions

*/

function sendMessage(recipient, message) {
  if (connections[recipient] != undefined && connections[recipient].conn.open) {
    console.log("SEND", message.label, "to", recipient);
    connections[recipient].conn.send(message);
    return;
  }

  if (connections[recipient] == undefined) {
    var new_connection = peer.connect(recipient, { serialization: 'json' });

    connections[recipient] = {conn: new_connection, links: 1, message_queue: []};

    connections[recipient].conn.on('data', function(data) {
      onMsgReceived(recipient, data)
    });

    connections[recipient].conn.on('open', function() {
      while (connections[recipient].message_queue.length != 0) {        
        var msg = connections[recipient].message_queue.shift();
        console.log("SEND", msg.label, "to", recipient);
        connections[recipient].conn.send(msg);
      }
    });

    connections[recipient].conn.on('close', function() {
      console.log("CLOSE connection with", recipient);
      delete connections[recipient];
    });
  }

  connections[recipient].message_queue.push(message);
}

function lookup(key) {
  if (isBetweenClockwise(key, hash(predecessor), hash(peer.id))) {
    return peer.id;
  }

  var result = findClosest(key);
  return fingerTable.get(result);
}

function fillLocalTable(locally) {
   // fill local table with own info
  insertToLocalTable(name, peer.id);
  insertToLocalTable(surname, peer.id);
  insertToLocalTable(email, peer.id);

  if (!locally) {
    // find owner for our data
    findWhereToInsert(name);
    findWhereToInsert(surname);
    findWhereToInsert(email);
  }
}

function selectDataToMove(new_peer) {
  var key = hash(new_peer);
  var result = {};
  for (var key_hash in localTable) {
    if (distance(key_hash, hash(new_peer)) < distance(key_hash, hash(peer.id))) {
      result[key_hash] = localTable[key_hash];
      delete localTable[key_hash];
    }
  }
  return result;
}

function insertToLocalTable(key, value) {
  if (localTable[hash(key)] == undefined) localTable[hash(key)] = [];
  localTable[hash(key)].push({ key: key, value: value});
}

function getFromLocalTable(key) {
  var results = localTable[hash(key)];

  for (var i in results) {
    if (results[i].key == key) return results[i].value;
  }

  return null;
}

function findWhereToInsert(key) {
  var potential_holder = lookup(hash(key));
  if (potential_holder != peer.id) {
    sendMessage(potential_holder, { label: 'lookup', key: hash(key), intention: 'insert_entry', initiator: peer.id });
  }
}

function onMsgReceived(sender, data) {
  console.log('RECEIVED from', sender, 'with label', data.label);
  switch(data.label) {
    case 'lookup':
      var potential_holder = lookup(data.key);

      if (potential_holder === peer.id) {
        sendMessage(data.initiator, { label: 'lookup_result', key: data.key, intention: data.intention, result: peer.id });
      } else {
        sendMessage(potential_holder, { label: 'lookup', key: data.key, intention: data.intention, initiator: data.initiator });
      }

      break;

    case 'lookup_and_get':
      var potential_holder = lookup(hash(data.key));

      if (potential_holder === peer.id) {
        sendMessage(data.initiator, { label: 'lookup_and_get_result', key: data.key, intention: data.intention, result: getFromLocalTable(data.key) });
      } else {
        sendMessage(potential_holder, { label: 'lookup_and_get', key: data.key, intention: data.intention, initiator: data.initiator });
      }

      break;

    case 'lookup_result':
      if (data.intention === 'find_successor') {
        successor = data.result;
        sendMessage(successor, { label: 'notify_successor' });
      }

      if (data.intention === 'find_finger') {
        fingersToFillLeft--;
        fingerTable.set(data.key, data.result);

        if (fingersToFillLeft == 0) {
          fillLocalTable(false);
        }
      }

      if (data.intention === 'insert_entry') {
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
          $('#messages').append('<span class="filler" style="background-color: #ff8c8c">' + 'Attempt to send private message failed because no such user exists' + '</span>');
        }
      }

      break;


    case 'notify_successor':
      var old_predecessor = predecessor;
      predecessor = sender;

      if (old_predecessor != peer.id) {
        sendMessage(old_predecessor, { label: 'notify_predecessor', new_peer: sender });
      } else {
        successor = sender;
      }
      sendMessage(sender, { label: 'notify_new_peer_about_predecessor' , 'predecessor': old_predecessor,  'data': selectDataToMove(sender) });

      break;

    case 'notify_predecessor':
      successor = data.new_peer;
      break;

    case 'notify_new_peer_about_predecessor':
      predecessor = data.predecessor;

      // update local table
      for (var index in data.data) {
        localTable[index] = data.data[index];
      }

      sendMessage(successor, { label: 'update_fingers_on_new_peer', new_peer: peer.id });

      break;

    case 'update_fingers_on_new_peer':
      var new_peer = data.new_peer;
      // notify successor about new peer as well
      if (successor != new_peer) sendMessage(successor, data);

      fixFingersOnNewPeer(new_peer);

      // the circle ended
      if (successor == new_peer) sendMessage(successor, { label: 'fingers_update_finished'});

      break;

    case 'fingers_update_finished':
      fillFingerTable();

      break;

    case 'insert_entry':
      for (var i in data.value) {
         insertToLocalTable(data.value[i].key, data.value[i]);
      }

      break;

    case 'private_messages':
      for (var index in data.messages) {
        displayMessage(sender, data.messages[index], true, true);
      }
      break;

    case 'public_message':
      // send the same message to successor
      if (successor != data.initiator) sendMessage(successor, data);
      displayMessage(sender, data.message, false, true);
      break;

    case 'predcessor_leaving':
      predecessor = data.predecessor;
      sendMessage(successor, { label: 'update_fingers_on_deleted_peer', deleted_peer: sender, new_holder: peer.id });

      for (i in data.data) {
        for (j in data.data[i]) {
          insertToLocalTable(data.data[i][j].key, data.data[i][j].value);
        }
      }

      fixFingersOnDeletedPeer(sender, peer.id);
      break;

    case 'update_fingers_on_deleted_peer':
      if (successor != data.deleted_peer && successor != peer.id && successor != data.new_holder) {
        sendMessage(successor, data);
      } else if (successor == data.deleted_peer) {
        successor = data.new_holder;
      }

      fixFingersOnDeletedPeer(data.deleted_peer, data.new_holder);
      break;
  }
}

function fixFingersOnNewPeer(new_peer) {
  for (var i = 0; i < m; i += 1) {
    var key_hash = fingerHash(i);
    var old_finger = fingerTable.get(key_hash);
    console.log('Check fingers for', key_hash, '. Old:', old_finger, ', New:', new_peer);
    if (distance(key_hash, hash(new_peer)) < distance(key_hash, hash(old_finger))) {
      console.log('Update finger', key_hash, 'from', old_finger, 'to', new_peer);
      fingerTable.set(key_hash, new_peer);
    }
  }
}

function fixFingersOnDeletedPeer(deleted_peer, new_holder) {
  for (var i = 0; i < m; i += 1) {
    var key_hash = fingerHash(i);
    console.log("Try update", key_hash, "from", fingerTable.get(key_hash), "because deleted", deleted_peer);
    if (fingerTable.get(key_hash) == deleted_peer) {
      console.log('Update finger', key_hash, 'from', deleted_peer, 'to', new_holder);
      fingerTable.set(key_hash, new_holder);
    }
  }
}

function fillFingerTable() {
  for (var i = 0; i < m; i += 1) {
    var key_hash = fingerHash(i);
    if (isBetweenClockwise(key_hash, hash(peer.id), hash(successor))) {
      fingersToFillLeft--;
      fingersFilledLocaly++;
      fingerTable.set(key_hash, successor);
    } else if (isBetweenClockwise(key_hash, hash(predecessor), hash(peer.id))) {
      fingersToFillLeft--;
      fingersFilledLocaly++;
      fingerTable.set(key_hash, peer.id);
    } else {
      sendMessage(successor, { label: 'lookup', key: key_hash, intention: 'find_finger', initiator: peer.id });
    }
  }

  if (fingersFilledLocaly === m) {
    fillLocalTable(false);
  }
}

/*

User Interface

*/

function displayMessage(name, msg, isPersonal, isReceived) {
  $('#messages').append(
       '<span class="filler" style="background-color: ' + (isPersonal ? '#74fcba' : '#a1fff2') + '">'
       + (isPersonal ? 'Personal Message' : 'Public message')
       + (isReceived ? ' from ' : ' to ')
       + (!isReceived && !isPersonal ? 'everyone' : name)
       + ': ' 
       + msg 
       + '</span>'
  );
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
      fingerTable.set(fingerHash(i), peer.id);
    }

    fillLocalTable(true);
  });

  $('#log_table').click(function() {
    console.log('Local Table:');
    for (var i in localTable) console.log(localTable[i]);
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
        var recipient = getFromLocalTable(name);
        sendMessage(recipient, {label: 'private_messages', messages: [msg.slice(msg.indexOf(' ') + 1)]});
      }
      displayMessage(name, msg.slice(msg.indexOf(' ')), true, false);
    } else if (msg.startsWith('/msg')) {
      var message = msg.slice(msg.indexOf(' ') + 1);
      var recipient = message.slice(0, message.indexOf(' '));
      sendMessage(recipient, {label: 'private_messages', messages: [message.slice(message.indexOf(' ') + 1)]});
      displayMessage(recipient, message.slice(message.indexOf(' ') + 1), true, false);
    } else {
      sendMessage(successor, {label: 'public_message', message: msg, initiator: peer.id});
      displayMessage(peer.id, msg, false, false);
    }
  });

});
