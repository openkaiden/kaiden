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

import { z } from 'zod';

const EnvoySocketAddressSchema = z.object({
  address: z.string(),
  port_value: z.number().int(),
});

const EnvoyAddressSchema = z.object({
  socket_address: EnvoySocketAddressSchema,
});

const EnvoyEndpointSchema = z.object({
  endpoint: z.object({ address: EnvoyAddressSchema, hostname: z.string().optional() }),
});

const EnvoyLoadAssignmentSchema = z.object({
  cluster_name: z.string(),
  endpoints: z.array(z.object({ lb_endpoints: z.array(EnvoyEndpointSchema) })),
});

const EnvoyTlsParamsSchema = z.object({
  tls_minimum_protocol_version: z.literal('TLSv1_2'),
  tls_maximum_protocol_version: z.literal('TLSv1_3'),
});
const EnvoyCommonTlsContextSchema = z.object({
  tls_params: EnvoyTlsParamsSchema,
});

const EnvoyUpstreamTlsContextSchema = z.object({
  '@type': z.literal('type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext'),
  sni: z.string(),
  common_tls_context: EnvoyCommonTlsContextSchema,
});

const EnvoyTransportSocketSchema = z.object({
  name: z.string(),
  typed_config: EnvoyUpstreamTlsContextSchema,
});

const EnvoyClusterSchema = z.object({
  name: z.string(),
  connect_timeout: z.string(),
  type: z.string(),
  http2_protocol_options: z.record(z.string(), z.unknown()).optional(),
  load_assignment: EnvoyLoadAssignmentSchema,
  dns_lookup_family: z.string().optional(),
  lb_policy: z.string().optional(),
  transport_socket: EnvoyTransportSocketSchema.optional(),
});

const EnvoyStringMatchSchema = z.object({
  exact: z.string(),
});

const EnvoyHeaderSchema = z.object({
  name: z.string(),
  string_match: EnvoyStringMatchSchema,
});

const EnvoyRouteClusterPatternSchema = z.object({
  google_re2: z.unknown(),
  regex: z.string(),
});
const EnvoyRouteClusterRegexRewriteSchema = z.object({
  pattern: EnvoyRouteClusterPatternSchema,
  substitution: z.string(),
});
const EnvoyRouteClusterSchema = z.object({
  cluster: z.string(),
  timeout: z.string().optional(),
  idleTimeout: z.string().optional(),
  host_rewrite_literal: z.string().optional(),
  regex_rewrite: EnvoyRouteClusterRegexRewriteSchema.optional(),
});

const EnvoyMatch = z.object({
  prefix: z.string(),
  headers: z.array(EnvoyHeaderSchema).optional(),
});

const EnvoyRouteSchema = z.object({
  match: EnvoyMatch,
  direct_response: z.object({ status: z.number().int() }).optional(),
  route: EnvoyRouteClusterSchema.optional(),
});

const EnvoyVirtualHostSchema = z.object({
  name: z.string(),
  domains: z.array(z.string()),
  request_headers_to_remove: z.array(z.string()).optional(),
  routes: z.array(EnvoyRouteSchema),
});

const EnvoyHttpFilterSchema = z.object({
  name: z.string(),
  typed_config: z.record(z.string(), z.unknown()),
});

const EnvoyHttpConnectionManagerSchema = z.object({
  '@type': z.string(),
  stat_prefix: z.string(),
  route_config: z.object({
    name: z.string(),
    virtual_hosts: z.array(EnvoyVirtualHostSchema),
  }),
  http_filters: z.array(EnvoyHttpFilterSchema),
  stream_idle_timeout: z.string().optional(),
  request_timeout: z.string().optional(),
});

const EnvoyFilterSchema = z.object({
  name: z.string(),
  typed_config: EnvoyHttpConnectionManagerSchema,
});

const EnvoyListenerSchema = z.object({
  name: z.string(),
  address: EnvoyAddressSchema,
  filter_chains: z.array(z.object({ filters: z.array(EnvoyFilterSchema) })),
});

export const EnvoyConfigSchema = z.object({
  static_resources: z.object({
    listeners: z.array(EnvoyListenerSchema),
    clusters: z.array(EnvoyClusterSchema),
  }),
  admin: z.object({ address: EnvoyAddressSchema }),
});

export type EnvoyConfig = z.infer<typeof EnvoyConfigSchema>;
export type EnvoyCluster = z.infer<typeof EnvoyClusterSchema>;
export type EnvoyRoute = z.infer<typeof EnvoyRouteSchema>;
