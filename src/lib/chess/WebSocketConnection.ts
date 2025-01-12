import {
  board_fen,
  client_id,
  current_player_white,
  debug_local_server,
  pending_move,
  playstate,
  reconnect_code,
  unread_move,
} from "$lib/store";
import { get } from "svelte/store";

export class WebSocketConnection {
  ws: WebSocket | undefined = undefined;
  messageHandlers: Map<string, ((data: any) => void)[]> = new Map();

  constructor() {
    // Register default handlers
    this.on("connected-id", (data) => this.handleIdMessage(data));
    this.on("matched", (data) => this.handleMatchedMessage(data));
    this.on(
      "receive-move",
      (data) => this.handleReceiveMoveMessage(data),
    );
    this.on(
      "accept-move",
      (data) => this.handleAcceptMoveMessage(data),
    );
    this.on(
      "reconnected",
      (data) => this.handleReconnectedMessage(data),
    );
    this.on("board", (data) => this.handleBoardStateMessage(data));
    this.on(
      "opponent-disconnected",
      () => this.handleOpponentDisconnected(),
    );
  }

  prepare(errorCallback?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(
        !get(debug_local_server)
          ? "wss://api.pawn-hub.de"
          : "ws://localhost:3000",
      );

      this.ws.onerror = () => {
        errorCallback?.call(this);
      };
      this.ws.onopen = () => resolve();
      this.ws.onmessage = (message) => this.handleMessage(message);
      this.ws.onclose = () => {
        if (get(reconnect_code)) this.handleConnectionClosed();
      };

      if (get(debug_local_server)) console.warn("Using local server");
    });
  }

  close() {
    reconnect_code.set(undefined);
    client_id.set("");
    playstate.set("closed");
    current_player_white.set(true);
    pending_move.set(false);
    this.ws?.close();
  }

  async handleConnectionClosed() {
    const code = get(reconnect_code);

    // Close game if not reconnected after 20 seconds
    setTimeout(() => {
      if (!get(reconnect_code) || code === get(reconnect_code)) this.close();
    }, 20000);

    // Reconnect using provided code
    await this.prepare();
    reconnect_code.set(undefined);

    this.send(JSON.stringify({
      "type": "reconnect",
      "id": get(client_id),
      "reconnect-code": code,
    }));
  }

  // Message handlers
  on(
    type: string,
    handler: (message: any) => void,
  ): () => void {
    let handlers = this.messageHandlers.get(type);
    if (!handlers) {
      handlers = [];
      this.messageHandlers.set(type, handlers);
    }
    handlers.push(handler);

    // Return destroy function
    return () => {
      if (!handlers) {
        console.warn(`Did not find handler ${type} to deregister`);
        return;
      }
      handlers.splice(handlers.indexOf(handler), 1);
    };
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
    this.readFEN(data.fen);
  }

  handleReceiveMoveMessage(data: any) {
    this.readFEN(data.fen);
    unread_move.set(true);
  }

  handleAcceptMoveMessage(data: any) {
    this.readFEN(data.fen);
    pending_move.set(false);
  }

  handleReconnectedMessage(data: any) {
    reconnect_code.set(data["reconnect-code"]);
    console.log("Reconnected");
  }

  handleBoardStateMessage(data: any) {
    this.readFEN(data.fen);
  }

  handleOpponentDisconnected() {
    this.close();
  }

  readFEN(data: string) {
    const fen = data.match(/^(.*)\s([b|w])/) || ["", ""];
    board_fen.set(fen[1]);
    current_player_white.set(fen[2] === "w");
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

  sendMove(from: string, to: string) {
    this.send(JSON.stringify({
      type: "send-move",
      from: from,
      to: to,
    }));
    pending_move.set(true);
  }
}

let _connection: WebSocketConnection | undefined = undefined;

export function connection(): WebSocketConnection {
  if (!_connection) {
    _connection = new WebSocketConnection();
  }
  return _connection;
}

export function determineIsGameId(input: string) {
  return Number(input) < 1000;
}
