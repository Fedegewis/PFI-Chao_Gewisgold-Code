import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});
