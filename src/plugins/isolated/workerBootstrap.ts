/**
 * Source that runs first inside the plugin's Worker, in the same script as the plugin bundle. It
 * exposes the `grimoire` SDK global and answers the host's heartbeat on its private port.
 *
 * Nothing here is a security boundary: the plugin shares this global scope and can replace any of
 * it. The host validates every message it receives and the iframe sandbox plus CSP contain the
 * Worker; this file only makes honest plugins convenient to write.
 *
 * It is a plain string (not a function body) so no bundler transform can alter it.
 */
export const WORKER_BOOTSTRAP = `
(function () {
  'use strict';
  var port = null;
  // Plugins run their top level before the host connects the channel; requests wait here.
  var outbox = [];
  var nextId = 1;
  var pending = new Map();
  var subscribers = { zoom: [], geometry: [], guides: [] };
  var commandHandlers = [];
  var MAX_PENDING = 16;

  function send(message) { port.postMessage(message); }

  function request(op, args) {
    return new Promise(function (resolve, reject) {
      if (pending.size >= MAX_PENDING) { reject(new Error('Too many pending requests')); return; }
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      var message = { v: 1, kind: 'req', id: id, op: op, args: args || {} };
      if (port) send(message); else outbox.push(message);
    });
  }

  function subscribe(topic, callback) {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    subscribers[topic].push(callback);
    var first = subscribers[topic].length === 1;
    var ready = first ? request('subscribe', { topic: topic }) : Promise.resolve(null);
    return ready.then(function (snapshot) {
      if (snapshot !== null) callback(snapshot);
      return function unsubscribe() {
        subscribers[topic] = subscribers[topic].filter(function (item) { return item !== callback; });
        if (!subscribers[topic].length) return request('unsubscribe', { topic: topic });
      };
    });
  }

  function onHostMessage(event) {
    var message = event.data;
    if (!message || message.v !== 1) return;
    if (message.kind === 'ping') { send({ v: 1, kind: 'pong', n: message.n }); return; }
    if (message.kind === 'res') {
      var entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error.code + ': ' + message.error.message));
      return;
    }
    if (message.kind === 'event') {
      var list = subscribers[message.topic] || [];
      for (var i = 0; i < list.length; i++) { try { list[i](message.data); } catch (error) { reportFault(error); } }
      return;
    }
    if (message.kind === 'command') {
      for (var j = 0; j < commandHandlers.length; j++) {
        try { commandHandlers[j](message.command, message.value); } catch (error) { reportFault(error); }
      }
    }
  }

  function reportFault(reason) {
    if (!port) return;
    var text = reason && reason.message ? String(reason.message) : String(reason);
    send({ v: 1, kind: 'fault', message: text.slice(0, 200) });
  }

  var sdk = Object.freeze({
    sdkVersion: 1,
    zoom: Object.freeze({
      get: function () { return request('zoom.get'); },
      set: function (value) { return request('zoom.set', { value: value }); },
      subscribe: function (callback) { return subscribe('zoom', callback); }
    }),
    geometry: Object.freeze({
      get: function () { return request('geometry.get'); },
      subscribe: function (callback) { return subscribe('geometry', callback); }
    }),
    guides: Object.freeze({
      list: function () { return request('guides.list'); },
      add: function (axis, positionMm) { return request('guides.add', { axis: axis, positionMm: positionMm }); },
      remove: function (guideId) { return request('guides.remove', { guideId: guideId }); },
      subscribe: function (callback) { return subscribe('guides', callback); }
    }),
    onCommand: function (handler) {
      if (typeof handler !== 'function') throw new TypeError('A handler is required');
      commandHandlers.push(handler);
    }
  });
  Object.defineProperty(self, 'grimoire', { value: sdk, enumerable: false });

  self.addEventListener('message', function (event) {
    var data = event.data;
    if (port || !data || data.type !== 'init' || !event.ports || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = onHostMessage;
    send({ v: 1, kind: 'ready' });
    var queued = outbox; outbox = [];
    for (var k = 0; k < queued.length; k++) send(queued[k]);
  });
  // Before the channel exists an error means the plugin failed to start: let it reach the frame.
  self.addEventListener('error', function (event) {
    if (!port) return;
    event.preventDefault();
    reportFault(event.message || 'Unhandled error');
  });
  self.addEventListener('unhandledrejection', function (event) { reportFault(event.reason); });
})();
`
