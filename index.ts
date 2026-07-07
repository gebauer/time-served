// MUST be first: polyfills crypto.getRandomValues on Hermes before any
// domain/crypto call (docs/CONTRACT_CHANGES.md #8 — J6's defaultRandomBytes
// fails loudly without it). No-op where the platform already provides it.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './src/app/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
