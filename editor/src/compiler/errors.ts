// SPDX-License-Identifier: Apache-2.0
export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}
