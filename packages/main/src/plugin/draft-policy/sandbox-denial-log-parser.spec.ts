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

import { beforeEach, describe, expect, test } from 'vitest';

import { SandboxDenialLogParser } from './sandbox-denial-log-parser.js';

describe('SandboxDenialLogParser', () => {
  let parser: SandboxDenialLogParser;

  beforeEach(() => {
    parser = new SandboxDenialLogParser();
  });

  describe('structured fields', () => {
    test('parses an L4 denial', () => {
      expect(
        parser.parse({
          fields: { l4_decision: 'deny', dst_host: 'example.com', dst_port: '443' },
          message: 'anything',
        }),
      ).toEqual({ isL7: false, host: 'example.com', port: 443, denyReason: undefined });
    });

    test('parses an L7 denial with method and path', () => {
      expect(
        parser.parse({
          fields: {
            l7_decision: 'deny',
            dst_host: 'api.example.com',
            dst_port: '8080',
            l7_action: 'POST',
            l7_target: '/v1/data',
          },
          message: 'anything',
        }),
      ).toEqual({
        isL7: true,
        host: 'api.example.com',
        port: 8080,
        method: 'POST',
        path: '/v1/data',
        binary: undefined,
        denyReason: undefined,
        protocol: undefined,
      });
    });

    test('parses an L7 GraphQL denial', () => {
      expect(
        parser.parse({
          fields: {
            l7_decision: 'deny',
            dst_host: 'api.example.com',
            dst_port: '443',
            l7_protocol: 'graphql',
            binary: '/usr/bin/curl',
          },
          message: 'anything',
        }),
      ).toMatchObject({ isL7: true, protocol: 'graphql', binary: '/usr/bin/curl' });
    });

    test('returns undefined when the structured denial lacks a destination', () => {
      expect(parser.parse({ fields: { l4_decision: 'deny', dst_host: 'example.com' }, message: '' })).toBeUndefined();
    });

    test('returns undefined when the structured port is not a number', () => {
      expect(
        parser.parse({
          fields: { l4_decision: 'deny', dst_host: 'example.com', dst_port: 'not-a-port' },
          message: '',
        }),
      ).toBeUndefined();
    });
  });

  describe('L7_REQUEST', () => {
    test('parses method, host, port and path', () => {
      expect(parser.parse({ fields: {}, message: 'L7_REQUEST deny POST api.example.com:8080/v1/data' })).toEqual({
        isL7: true,
        host: 'api.example.com',
        port: 8080,
        method: 'POST',
        path: '/v1/data',
        denyReason: 'L7_REQUEST deny POST api.example.com:8080/v1/data',
      });
    });

    test('parses GraphQL operation details', () => {
      expect(
        parser.parse({
          fields: {},
          message:
            'L7_REQUEST deny POST api.example.com:443/graphql graphql_ops=type=mutation name=UpdateUser fields=a,b',
        }),
      ).toMatchObject({
        isL7: true,
        protocol: 'graphql',
        operationType: 'mutation',
        operationName: 'UpdateUser',
        graphqlFields: ['a', 'b'],
      });
    });

    test('returns undefined for an allow decision', () => {
      expect(parser.parse({ fields: {}, message: 'L7_REQUEST allow POST api.example.com:443/' })).toBeUndefined();
    });

    test('returns undefined when the target has no port', () => {
      expect(parser.parse({ fields: {}, message: 'L7_REQUEST deny POST api.example.com/path' })).toBeUndefined();
    });
  });

  describe('HTTP denials', () => {
    test('parses an HTTP denial with reason', () => {
      expect(
        parser.parse({
          fields: {},
          message: 'HTTP:POST [MED] DENIED proc(123) -> POST https://api.example.com:443/v1 [reason:l7 policy]',
        }),
      ).toEqual({
        isL7: true,
        protocol: 'rest',
        host: 'api.example.com',
        port: 443,
        method: 'POST',
        path: '/v1',
        denyReason: 'l7 policy',
      });
    });
  });

  describe('L4 network denials', () => {
    test('parses a NET denial without an actor prefix', () => {
      expect(parser.parse({ fields: {}, message: 'NET:CONNECT [LOW] DENIED example.com:443' })).toEqual({
        isL7: false,
        host: 'example.com',
        port: 443,
        denyReason: undefined,
      });
    });

    test('parses a NET denial with an actor prefix', () => {
      expect(parser.parse({ fields: {}, message: 'NET:CONNECT [MED] DENIED proc(12) -> example.com:443' })).toEqual({
        isL7: false,
        host: 'example.com',
        port: 443,
        denyReason: undefined,
      });
    });
  });

  test('returns undefined for non-denial log lines', () => {
    expect(parser.parse({ fields: {}, message: 'INFO sandbox is ready' })).toBeUndefined();
  });

  test('returns undefined for an unparsable denial', () => {
    expect(parser.parse({ fields: {}, message: 'DENIED something unexpected' })).toBeUndefined();
  });
});
