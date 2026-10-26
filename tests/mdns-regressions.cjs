const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { Bonjour, Service } = require('bonjour-service');
const mdnsServerMod = require('bonjour-service/dist/lib/mdns-server');

test('bonjour-service default errorCallback throws if not provided', () => {
  const Server = mdnsServerMod.Server || mdnsServerMod.default;
  const server = new Server();
  assert.throws(
    () => {
      server.errorCallback(new Error('send EADDRNOTAVAIL 224.0.0.251:5353'));
    },
    { message: /send EADDRNOTAVAIL/ }
  );
  server.mdns.destroy();
});

test('bonjour-service with safe errorCallback does not throw', () => {
  const Server = mdnsServerMod.Server || mdnsServerMod.default;
  let caughtError = null;
  const server = new Server({}, (err) => {
    caughtError = err;
  });

  assert.doesNotThrow(() => {
    server.errorCallback(new Error('send EADDRNOTAVAIL 224.0.0.251:5353'));
  });
  assert.equal(caughtError?.message, 'send EADDRNOTAVAIL 224.0.0.251:5353');
  server.mdns.destroy();
});

test('patchBonjourService patches Server to suppress throw in respondToQuery', () => {
  const Server = mdnsServerMod.Server || mdnsServerMod.default;
  let loggedWarning = null;

  // Simulate what patchBonjourService does
  const origRespondToQuery = Server.prototype.respondToQuery;
  Server.prototype.respondToQuery = function (query) {
    if (!this.errorCallback || this.errorCallback.toString().includes('throw err')) {
      this.errorCallback = (err) => {
        loggedWarning = err.message;
      };
    }
    return origRespondToQuery.call(this, query);
  };

  const server = new Server();
  server.respondToQuery({ questions: [] });
  assert.doesNotThrow(() => {
    server.errorCallback(new Error('send EADDRNOTAVAIL 224.0.0.251:5353'));
  });
  assert.equal(loggedWarning, 'send EADDRNOTAVAIL 224.0.0.251:5353');
  server.mdns.destroy();
});

test('dgram send with callback handles send error without throwing uncaughtException', (t, done) => {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  s.bind(0, () => {
    // Sending to multicast address with callback
    s.send(Buffer.from('ping'), 0, 4, 5353, '224.0.0.251', (err) => {
      // Regardless of err or success, callback is called and no uncaught exception occurs
      s.close(done);
    });
  });
});
