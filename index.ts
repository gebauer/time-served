// BOOTSTRAP ORDER (CONTRACT_CHANGES.md #8): the crypto.getRandomValues polyfill
// MUST be the first import — J6's domain crypto (defaultRandomBytes) fails
// loudly on Hermes without it, and services/wiring load transitively from App.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './src/app/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
