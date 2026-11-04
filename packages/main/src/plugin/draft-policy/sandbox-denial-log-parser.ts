/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { injectable } from 'inversify';

/** A network access denial extracted from a single sandbox log line. */
export interface SandboxDenial {
  isL7: boolean;
  host: string;
  port: number;
  method?: string;
  path?: string;
  binary?: string;
  denyReason?: string;
  protocol?: 'rest' | 'graphql';
  operationType?: string;
  operationName?: string;
  graphqlFields?: string[];
}

/** The subset of a sandbox log line this parser needs. */
export interface SandboxLogLine {
  fields: { [key: string]: string };
  message: string;
}

const L7_REQUEST_PREFIX = 'L7_REQUEST';
const DENIED_MARKER = 'DENIED';
const GRAPHQL_OPS_PATTERN = /graphql_ops=(.+?)(?= persisted=| \[|$)/;
const HTTP_DENIAL_PATTERN = /DENIED\s+(?:\S+\s+->\s+)?(\w+)\s+\w+:\/\/([^/:]+):(\d+)(\/\S*)?/;
const NETWORK_DENIAL_PATTERN = /^NET:\w+ +\[\w+\] +DENIED +(?:\S+ +-> +)?([^:\s]+):(\d+)/;
const DENY_REASON_PATTERN = /\[reason:([^\]]+)\]/;

/** Parses OpenShell sandbox log lines into structured network denials. */
@injectable()
export class SandboxDenialLogParser {
  parse(logLine: SandboxLogLine): SandboxDenial | undefined {
    return this.#parseStructuredFields(logLine.fields) ?? this.#parseMessage(logLine.message);
  }

  // Sandbox-pushed non-OCSF logs may populate structured fields directly.
  #parseStructuredFields(fields: { [key: string]: string }): SandboxDenial | undefined {
    if (fields['l4_decision'] !== 'deny' && fields['l7_decision'] !== 'deny') {
      return undefined;
    }

    const host = fields['dst_host'];
    const portStr = fields['dst_port'];
    if (!host || !portStr) return undefined;
    const port = Number.parseInt(portStr, 10);
    if (Number.isNaN(port)) return undefined;

    return {
      isL7: fields['l7_decision'] === 'deny',
      host,
      port,
      method: fields['l7_action'],
      path: fields['l7_target'],
      binary: fields['binary'],
      denyReason: fields['l7_deny_reason'] ?? fields['l4_deny_reason'],
      protocol: fields['l7_protocol'] === 'graphql' ? 'graphql' : undefined,
    };
  }

  #parseMessage(msg: string): SandboxDenial | undefined {
    // L7_REQUEST denial (GraphQL, MCP, etc.):
    //   L7_REQUEST deny POST host:port/path graphql_ops=type=mutation name=Op fields=f1,f2 ...
    if (msg.startsWith(L7_REQUEST_PREFIX)) {
      return this.#parseL7Request(msg);
    }

    if (!msg.includes(DENIED_MARKER)) return undefined;

    const denyReason = DENY_REASON_PATTERN.exec(msg)?.[1]?.trim();

    // L7 HTTP denial: HTTP:POST [MED] DENIED proc(pid) -> POST https://host:port/path
    const httpMatch = msg.startsWith('HTTP:') ? HTTP_DENIAL_PATTERN.exec(msg) : undefined;
    if (httpMatch?.[2] && httpMatch[3]) {
      return {
        isL7: true,
        protocol: 'rest',
        host: httpMatch[2],
        port: Number.parseInt(httpMatch[3], 10),
        method: httpMatch[1],
        path: httpMatch[4] ?? '/',
        denyReason,
      };
    }

    // L4 network denial
    const netMatch = NETWORK_DENIAL_PATTERN.exec(msg);
    if (netMatch?.[1] && netMatch[2]) {
      return {
        isL7: false,
        host: netMatch[1],
        port: Number.parseInt(netMatch[2], 10),
        denyReason,
      };
    }

    return undefined;
  }

  #parseL7Request(msg: string): SandboxDenial | undefined {
    const parts = msg.split(' ');
    if (parts.length < 4 || parts[1] !== 'deny') return undefined;

    const method = parts[2];
    const target = parts[3];
    if (!method || !target) return undefined;

    const colonIdx = target.indexOf(':');
    if (colonIdx < 1) return undefined;

    const host = target.substring(0, colonIdx);
    const afterColon = target.substring(colonIdx + 1);
    const slashIdx = afterColon.indexOf('/');
    const portStr = slashIdx >= 0 ? afterColon.substring(0, slashIdx) : afterColon;
    const port = Number.parseInt(portStr, 10);
    if (Number.isNaN(port)) return undefined;

    const denial: SandboxDenial = {
      isL7: true,
      host,
      port,
      method,
      path: slashIdx >= 0 ? afterColon.substring(slashIdx) : '/',
      denyReason: msg,
    };

    const opsStr = GRAPHQL_OPS_PATTERN.exec(msg)?.[1];
    if (opsStr) {
      denial.protocol = 'graphql';
      denial.operationType = /type=(\w+)/.exec(opsStr)?.[1];
      denial.operationName = /name=(\w+)/.exec(opsStr)?.[1];
      denial.graphqlFields = /fields=(\S+)/.exec(opsStr)?.[1]?.split(',');
    }

    return denial;
  }
}
