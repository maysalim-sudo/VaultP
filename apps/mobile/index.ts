// Must come before anything that touches `crypto`. React Native has no
// getRandomValues of its own, and core uses it for ids and key material — without
// this the first id generated would throw.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
