import { createHash } from "node:crypto";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** WebSocket 握手固定 GUID（RFC 6455）。 */
const WS_HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** WebSocket 操作码（opcode）常量。 */
const WS_OPCODE_CONTINUATION = 0x0;
const WS_OPCODE_TEXT = 0x1;
const WS_OPCODE_BINARY = 0x2;
const WS_OPCODE_CLOSE = 0x8;
const WS_OPCODE_PING = 0x9;
const WS_OPCODE_PONG = 0xa;

/** 单个 WebSocket 连接的内部描述。 */
interface WsConnection {
  /** 底层套接字 */
  socket: Duplex;
  /** 尚未解析完的字节缓冲 */
  buffer: Buffer;
  /** 跨分片累积的 payload（仅在分片帧时使用） */
  fragments: Buffer;
  /** 分片序列起始帧的数据 opcode（text / binary） */
  fragmentOpcode: number;
}

/** 解析出的单帧数据。 */
interface WsFrame {
  /** 操作码 */
  opcode: number;
  /** 帧载荷（已去掩码） */
  payload: Buffer;
  /** 该帧在缓冲区中占用的总字节数 */
  totalLength: number;
  /** 是否为消息的最后一帧 */
  fin: boolean;
}

/** 暴露给业务层的连接句柄（仅可发送 / 关闭）。 */
export interface WsClient {
  /** 向该连接发送一段文本（如 JSON 字符串） */
  send(data: string): void;
  /** 关闭该连接 */
  close(): void;
}

/** 新连接建立回调。 */
export type WsConnectionHandler = (client: WsClient) => void;
/** 收到客户端文本消息回调。 */
export type WsMessageHandler = (client: WsClient, data: string) => void;

/**
 * 极简 WebSocket 服务端：仅依赖 Node 内置模块，覆盖本项目所需的
 * 「握手 -> 收文本（客户端掩码）/ 发文本（服务端不掩码）/ ping-pong / close」能力，
 * 不引入第三方库。足以支撑本地的单页状态看板通信。
 */
export class WebSocketHub {
  /** 当前全部活跃连接 */
  private readonly connections = new Set<WsConnection>();
  /** 新连接回调 */
  private connectionHandler?: WsConnectionHandler;
  /** 文本消息回调 */
  private messageHandler?: WsMessageHandler;

  /**
   * @param path 仅处理该路径前缀的升级请求（如 "/ws"），其余升级一律拒绝
   */
  constructor(private readonly path: string = "/ws") {}

  /** 绑定到 HTTP 服务，接管指定路径的 WebSocket 升级请求。 */
  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(this.path)) {
        socket.destroy();
        return;
      }
      this.handleUpgrade(req, socket, head);
    });
  }

  /** 注册新连接建立回调（常用于连接后推送初始数据）。 */
  onConnection(handler: WsConnectionHandler): void {
    this.connectionHandler = handler;
  }

  /** 注册客户端文本消息回调。 */
  onMessage(handler: WsMessageHandler): void {
    this.messageHandler = handler;
  }

  /** 向全部连接广播一段文本。 */
  broadcast(data: string): void {
    for (const conn of this.connections) {
      this.sendText(conn.socket, data);
    }
  }

  /** 执行 WebSocket 握手并将连接纳入管理。 */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (req.headers["upgrade"]?.toLowerCase() !== "websocket" || !key) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + WS_HANDSHAKE_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const conn: WsConnection = {
      socket,
      buffer: head,
      fragments: Buffer.alloc(0),
      fragmentOpcode: 0,
    };
    this.connections.add(conn);
    socket.on("data", (chunk: Buffer) => this.onData(conn, chunk));
    socket.on("close", () => this.connections.delete(conn));
    socket.on("error", () => this.connections.delete(conn));

    const client: WsClient = {
      send: (data: string) => this.sendText(socket, data),
      close: () => this.closeConn(conn),
    };
    this.connectionHandler?.(client);
  }

  /** 累积数据并尽可能多地解析出完整帧。 */
  private onData(conn: WsConnection, chunk: Buffer): void {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    let frame = this.parseFrame(conn.buffer);
    while (frame) {
      conn.buffer = conn.buffer.subarray(frame.totalLength);
      this.handleFrame(conn, frame);
      frame = this.parseFrame(conn.buffer);
    }
  }

  /**
   * 解析一个 WebSocket 帧。缓冲区不足一个完整帧时返回 null（等待更多数据）。
   * 客户端发来的帧按规范必须掩码，此处会自动去掩码。
   */
  private parseFrame(buf: Buffer): WsFrame | null {
    if (buf.length < 2) {
      return null;
    }
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;
    if (payloadLen === 126) {
      if (buf.length < offset + 2) {
        return null;
      }
      payloadLen = buf.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (buf.length < offset + 8) {
        return null;
      }
      payloadLen = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }
    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) {
        return null;
      }
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + payloadLen) {
      return null;
    }
    let payload = buf.subarray(offset, offset + payloadLen);
    if (masked && maskKey) {
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ maskKey[i & 3];
      }
      payload = unmasked;
    }
    return { opcode, payload, totalLength: offset + payloadLen, fin };
  }

  /** 按操作码分发一帧。 */
  private handleFrame(conn: WsConnection, frame: WsFrame): void {
    switch (frame.opcode) {
      case WS_OPCODE_TEXT:
      case WS_OPCODE_BINARY:
        if (frame.fin) {
          this.deliver(conn, frame.payload, frame.opcode);
        } else {
          conn.fragmentOpcode = frame.opcode;
          conn.fragments = frame.payload;
        }
        break;
      case WS_OPCODE_CONTINUATION:
        conn.fragments = Buffer.concat([conn.fragments, frame.payload]);
        if (frame.fin) {
          const full = conn.fragments;
          const opcode = conn.fragmentOpcode;
          conn.fragments = Buffer.alloc(0);
          conn.fragmentOpcode = 0;
          this.deliver(conn, full, opcode);
        }
        break;
      case WS_OPCODE_CLOSE:
        this.closeConn(conn);
        break;
      case WS_OPCODE_PING:
        this.sendControl(conn.socket, WS_OPCODE_PONG, frame.payload);
        break;
      case WS_OPCODE_PONG:
        break;
      default:
        break;
    }
  }

  /** 仅处理文本消息（本项目协议均为 JSON 文本）。 */
  private deliver(conn: WsConnection, payload: Buffer, opcode: number): void {
    if (opcode !== WS_OPCODE_TEXT) {
      return;
    }
    const text = payload.toString("utf8");
    const client: WsClient = {
      send: (data: string) => this.sendText(conn.socket, data),
      close: () => this.closeConn(conn),
    };
    this.messageHandler?.(client, text);
  }

  /** 服务端 -> 客户端：发送未掩码的文本帧。 */
  private sendText(socket: Duplex, data: string): void {
    if (!socket.writable) {
      return;
    }
    const payload = Buffer.from(data, "utf8");
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  /** 服务端 -> 客户端：原样回带载荷的控制帧（ping -> pong）。 */
  private sendControl(socket: Duplex, opcode: number, payload: Buffer): void {
    if (!socket.writable) {
      return;
    }
    const header = Buffer.from([0x80 | opcode, payload.length]);
    socket.write(Buffer.concat([header, payload]));
  }

  /** 发送关闭帧并结束连接。 */
  private closeConn(conn: WsConnection): void {
    if (conn.socket.writable) {
      conn.socket.write(Buffer.from([0x88, 0x00]));
    }
    conn.socket.end();
    this.connections.delete(conn);
  }
}
