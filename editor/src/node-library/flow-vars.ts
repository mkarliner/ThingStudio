// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/flow-vars.ts
//
// The flow-wide in-RAM store shared by a function node's flow.get/set and the change node. runtime.shared since
// 2026-10-21; the runtime clears its singletons on redeploy, matching the old module-dict reset.

export const FLOW_VARS_DICT = "_flow_vars";
export const FLOW_VARS_SETUP = `${FLOW_VARS_DICT} = runtime.shared('flow_vars', 'v1', 'v1', lambda: {})`;
