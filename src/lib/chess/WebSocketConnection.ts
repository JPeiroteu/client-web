import { browser } from "$app/environment";
import { beforeNavigate, goto } from "$app/navigation";
import { client_id, playstate, reconnect_code } from "$lib/store";
import { onMount } from "svelte";
import { get } from "svelte/store";

export class WebSocketConnection {
  ws: WebSocket | undefined = undefined;
  messageHandlers: Map<string, ((message: string) => void)[]> = new Map();

  constructor() {
    this.registerHandler("connected-id", (data) => this.handleIdMessage(data));
    this.registerHandler("matched", (data) => this.handleMatchedMessage(data));
    this.registerHandler("reconnected", (data) => this.handleReconnectedMessage(data));
  }

  prepare(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket("wss://api.pawn-hub.de");
      this.ws.onopen = () => resolve();
      this.ws.onmessage = (message) => this.handleMessage(message);
      this.ws.onclose = () => this.handleConnectionClosed();
    });
  }

  async handleConnectionClosed() {
    // Reconnect using provided code
    console.log("Attempting to reconnect");

    await this.prepare();

    console.log("Opened new WebSocket");

    this.send(JSON.stringify({
      "type": "reconnect",
      "id": get(client_id),
      "reconnect-code": get(reconnect_code),
    }));
  }

  // Message handlers

  registerHandler(
    type: string,
    handler: (message: any) => void,
  ) {
    let handlers = this.messageHandlers.get(type);
    if (!handlers) {
      handlers = [];
      this.messageHandlers.set(type, handlers);
    }
    handlers.push(handler);
  }

  private handleMessage(message: MessageEvent) {
    const data = JSON.parse(message.data);
    console.log("Received message: " + message.data);

    const handlers = this.messageHandlers.get(data.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  handleIdMessage(data: any) {
    client_id.set(data.id);
    reconnect_code.set(data["reconnect-code"]);
  }

  handleMatchedMessage(data: any) {
    playstate.set("playing");
    goto("/play/game");
  }

  handleReconnectedMessage(data: any) {
    reconnect_code.set(data["reconnect-code"]);
  }

  // Emit messages

  send(message: string) {
    console.log("Sending message: " + message);
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Host is not open");
    }
    this.ws.send(message);
  }

  sendConnectRequest(hostId: string, code: string) {
    this.send(JSON.stringify({
      type: "connect-attendee",
      host: hostId,
      code: code,
    }));
  }
}

let _connection: WebSocketConnection | undefined = undefined;

export function connection(): WebSocketConnection {
  if (!_connection) {
    _connection = new WebSocketConnection();
  }
  return _connection;
}
