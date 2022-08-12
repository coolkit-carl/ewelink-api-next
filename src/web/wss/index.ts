import { Ws } from "../Ws.js";
import { storage } from "../../cache/index.js";
import { nonce } from "../../utils/index.js";
import WebSocket from "ws";

let ws: WebSocket; // WebSocket instance
let hbIntervalTimer: any; // Heartbeat timer instance

// Foundation type
export type baseInfo = {
  region?: string | "cn" | "as" | "us" | "eu" | "test";
  fullUrl?: string;
};

// Type when establishing connection
export type connectInfo = {
  region?: string | "cn" | "as" | "us" | "eu" | "test";
  fullUrl?: string;
  at: string;
  userApiKey: string;
  appId: string | "";
  userAgent?: string | "app";
};

export class Connect {
  constructor(protected readonly root: Ws) {}

  // Get the assigned long connection address
  getDispatch = async (options: baseInfo) => {
    let res;
    if (options?.fullUrl) {
      res = await this.root.request.get(options.fullUrl);
    } else if (options?.region) {
      res = await this.root.request.get(
        `https://${options?.region}-dispa.coolkit.${
          ["cn", "test"].includes(options?.region) ? "cn" : "cc"
        }/dispatch/app`
      );
    } else {
      res = await this.root.request.get("https://dispa.coolkit.cc/dispatch/app");
    }
    let { IP, port, domain, reason } = res;
    if (reason !== "ok") throw new Error("Long connection address acquisition failed");
    storage.set("ws", { IP, port, domain });
    return `wss://${domain}:${port}/api/ws`;
  };

  // Creat a websocket heartbeat timer
  createHbTimer = ({ hb = 0, hbInterval = 145 } = {}) => {
    // Clear the previous heartbeat timer
    hbIntervalTimer && clearInterval(hbIntervalTimer);
    if (!hb) return;
    // Create a new heartbeat timer
    let intervalTime = Math.ceil(hbInterval * (0.8 + 0.2 * Math.random()));
    hbIntervalTimer = setInterval(() => {
      this.root.logger?.info("Send ping: ping");
      ws.send("ping");
    }, intervalTime * 1000);
    this.root.logger?.info(`A timer for sending heartbeat packets has been created. Time interval: ${intervalTime}s`);
  };

  // Create a websocket connection
  create = async (options: connectInfo) => {
    // If fullUrl is provided, use it directly
    if (options?.fullUrl) {
      ws = new WebSocket(options.fullUrl);
    } else {
      if (!options?.region) throw new Error("region is required");
      ws = new WebSocket(await this.getDispatch({ region: options.region }));
    }
    // Set onopen event
    ws.onopen = () => {
      // Send userOnline message
      this.root.logger?.info("WebSocket connection has been established");
      const data = {
        action: "userOnline",
        at: options.at || this.root.at || "",
        apikey: options.userApiKey || this.root.userApiKey || "",
        appid: options.appId || this.root.appId || "",
        nonce: nonce(),
        userAgent: "app",
        sequence: new Date().getTime().toString()
      };
      this.root.logger?.info(`Send userOnline message: ${JSON.stringify(data)}`);
      ws?.send(JSON.stringify(data));
    };
    // Set onclose event
    ws.onclose = () => {
      if (hbIntervalTimer) {
        clearInterval(hbIntervalTimer);
        this.root.logger?.info("WebSocket hbIntervalTimer cleared");
      }
      this.root.logger?.info("WebSocket connection has been closed");
      ws && ws.close();
    };

    // Set onerror event
    ws.onerror = (error) => {
      this.root.logger?.info("WebSocket connection dropped, please reconnect, error: " + error.message);
      if (hbIntervalTimer) {
        clearInterval(hbIntervalTimer);
        this.root.logger?.info("WebSocket hbIntervalTimer cleared");
      }
    };

    // Set onmessage event
    ws.onmessage = (message) => {
      this.root.logger?.info("WebSocket response received: " + message.data);
      if (message.data.toString()[0] == "{" && JSON.parse(message.data.toString())?.config) {
        this.root.logger?.info("WebSocket handshake succeeded, creating heartbeat timer");
        this.createHbTimer(JSON.parse(message.data.toString())?.config);
      }
    };
    return ws;
  };
  // Get userOnline message for your own business
  getUserOnline = async (options: connectInfo) => {
    return JSON.stringify({
      action: "userOnline",
      at: options.at || this.root.at || "",
      apikey: options.userApiKey || this.root.userApiKey || "",
      appid: options.appId || this.root.appId || "",
      nonce: nonce(),
      userAgent: options?.userAgent || "app",
      sequence: new Date().getTime().toString()
    });
  };

  // Get updateState message for your own business
  getUpdateState = (
    deviceId: string,
    params: object,
    action?: string | "update" | "upgrade" | "date",
    userAgent?: string | "app",
    userApiKey?: string
  ) => {
    const data: object = {
      action: action || "update",
      apikey: userApiKey || this.root.userApiKey,
      deviceid: deviceId,
      params: params,
      userAgent: userAgent || "app",
      nonce: nonce(),
      sequence: new Date().getTime().toString()
    };
    return JSON.stringify(data);
  };

  // Update device status
  updateState = (
    deviceId: string,
    params: object,
    action?: string | "update" | "upgrade" | "date",
    userAgent?: string | "app",
    userApiKey?: string
  ) => {
    if (ws.readyState !== 1) {
      this.root.logger?.info("WebSocket is not connected");
      return;
    }
    const data: string = this.getUpdateState(deviceId, params, action, userAgent, userApiKey);
    this.root.logger?.info("Send update message:：" + data);
    ws?.send(data);
  };
}
export interface Connect {}
