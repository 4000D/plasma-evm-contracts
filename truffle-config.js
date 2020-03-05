require('dotenv').config();

const PrivateKeyProvider = require('truffle-privatekey-provider');

const ADDR0 = '0x37da08b6Cd15c3aE905A25Df57B6841A5D80aC93';
const ADDR1 = '0xb79749F25Ef64F9AC277A4705887101D3311A0F4';
const ADDR2 = '0x5E3230019fEd7aB462e3AC277E7709B9b2716b4F';
const ADDR3 = '0x515B385bDc89bCc29077f2B00a88622883bfb498';
const ADDR4 = '0xC927A0CF2d4a1B59775B5D0A35ec76d099e1FaD4';
const ADDR5 = '0x48aFf0622a866d77651eAaA462Ea77b5F39D0ae1';
const ADDR6 = '0xb715125A08140AEA83588a4b569599cde4a0a336';
const ADDR7 = '0x499De281cd965781F1422b7cB73367C15DC416D2';
const ADDR8 = '0xaA60af9BD19dc7438fd19457955C52982D070D27';
const ADDR9 = '0xb4cE59ACF42e1BbA4FeDb5Ec91736d56Ce8A97Be';

const KEY0 = '5c148c5ba69b7b5c4e53d222e74e6edbbea72f3744fe2ab770320ae70b8d42c0';
const KEY1 = '2628ca66087c6bc7f9eff7d70db7413d435e170040e8342e67b3db4e55ce752f';
const KEY2 = '86e60281da515184c825c3f46c7ec490b075af1e74607e2e9a66e3df0fa22122';
const KEY3 = 'b77b291fab2b0a9e03b5ee0fb0f1140ff41780e93a39e534d54a05ccfad3eead';
const KEY4 = '54a93b74538a7ab51062c7314ea9838519acae6b4ea3d47a7f367e866010364d';
const KEY5 = '434e494f59f6228481256c0c88a375eef2c57be70e612576f302337f48a4634b';
const KEY6 = 'c85ab6a568ce788082664c0c17f86e332793895750455090f30f4578e4d20f9a';
const KEY7 = '83d58f7a18e85b728bf5b00ce92d0d8491ae51a962331c8626e51ac32ba8b5f7';
const KEY8 = '85a7751420007fba52e23eca493ac40c770b63c7a16f27ffec39fa01061bc435';
const KEY9 = '4F88249B582D0DA503F974F364A01DDE5F95A51797087C58DF9C26732B13C90A';

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    rootchain: {
      host: 'localhost',
      port: 8546,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
      websocket: true,
    },
    plasma: {
      host: 'localhost',
      port: 8547,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    faraday: {
      host: '13.125.10.20',
      port: 8545,
      gas: 7500000,
      gasPrice: 1e9,
      network_id: '*', // eslint-disable-line camelcase
    },
    carl2: {
      provider: new PrivateKeyProvider(KEY0, 'http://carl-2.node.tokamak.network:8545'),
      // host: 'carl-2.node.tokamak.network:8546',
      // port: 8545,
      gas: 7500000,
      gasPrice: 20e9,
      // websocket: true,
      network_id: '*', // eslint-disable-line camelcase
    },
  //   ropsten: {
  //     provider: ropstenProvider,
  //     network_id: 3, // eslint-disable-line camelcase
  //   },
  //   coverage: {
  //     host: 'localhost',
  //     network_id: '*', // eslint-disable-line camelcase
  //     port: 8555,
  //     gas: 0xfffffffffff,
  //     gasPrice: 0x01,
  //   },
  //   ganache: {
  //     host: 'localhost',
  //     port: 8545,
  //     network_id: '*', // eslint-disable-line camelcase
  //   },
  },
  mocha: {
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD',
      gasPrice: 21,
    },
    useColors: true,
    enableTimeouts: false,
    bail: true,
  },
  compilers: {
    solc: {
      version: '0.5.12',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },
};
