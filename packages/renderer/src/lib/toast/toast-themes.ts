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

/**
 * Shared theme constants for @zerodevx/svelte-toast notifications.
 * Re-used across ToastHandler and any component calling toast.push() directly.
 */

export const toastThemes: Record<string, Record<string, string>> = {
  success: {
    '--toastBackground': '#16a34a',
    '--toastColor': '#bbf7d0',
    '--toastBarBackground': '#14532d',
  },
  error: {
    '--toastBackground': 'red',
    '--toastColor': 'white',
    '--toastBarBackground': 'maroon',
  },
  warning: {
    '--toastBackground': 'yellow',
    '--toastColor': 'black',
    '--toastBarBackground': 'olive',
  },
  info: {
    '--toastBackground': 'blue',
    '--toastColor': 'white',
    '--toastBarBackground': 'navy',
  },
};
