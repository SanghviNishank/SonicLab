import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

// jsdom has no media playback: provide minimal, controllable stand-ins.
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { Object.defineProperty(this, "paused", { configurable: true, value: false }); this.dispatchEvent(new Event("play")); return Promise.resolve(); }) });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn(function (this: HTMLMediaElement) { Object.defineProperty(this, "paused", { configurable: true, value: true }); this.dispatchEvent(new Event("pause")); }) });
