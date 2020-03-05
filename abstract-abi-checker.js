const sort = require('lodash/sortBy');
const get = require('lodash/get');
const find = require('lodash/find');
const includes = require('lodash/includes');

const INTERFACE_PATH = './build/contracts/SeigManagerI.json';
const IMPLEMENTATION_PATH = './build/contracts/SeigManager.json';

// const interfaceABI = sort(require(INTERFACE_PATH).abi, ['name']);
// const implementationABI = sort(require(IMPLEMENTATION_PATH).abi, ['name']);
const interfaceABI = sort(require(INTERFACE_PATH).abi, ['name']).filter(({ type }) => type === 'function');
const implementationABI = sort(require(IMPLEMENTATION_PATH).abi, ['name']).filter(({ type }) => type === 'function');

console.log(`

interfaceABI       : ${interfaceABI.map(({ constant, inputs, name, outputs }) => name)}
implementationABI  : ${implementationABI.map(({ constant, inputs, name, outputs }) => name)}
`)
;

function checkImplementation (interfaceABI = [], implementationABI = []) {
  const interfaceNames = interfaceABI.map(({ name }) => name);
  const implementationNames = implementationABI.map(({ name }) => name);

  console.log(`
  interfaceNames      ${JSON.stringify(interfaceNames)}
  implementationNames ${JSON.stringify(implementationNames)}
  `);

  const included = interfaceNames.filter(name => includes(implementationNames, name));
  const notIncluded = interfaceNames.filter(name => !includes(implementationNames, name));

  if (interfaceNames.length !== included.length) {
    throw new Error(`
    Implementation doesn't includes below abstract functions
        ${JSON.stringify(notIncluded)}

    -- included
        ${JSON.stringify(included)}

    `);
  }

  return true;
}

function _checkKey (interfaceABI = [], implementationABI = [], key = '') {
  if (!key) throw new Error('Empty key');

  // TODO: get ABI by name!
  const names = interfaceABI.map(o => o.name);

  const s = names.map(name => interfaceABI.find(o => o.name === name));
  const t = names.map(name => implementationABI.find(o => o.name === name));

  if (!s || !t) throw new Error(`Failed to get ${key}`);

  const sStr = JSON.stringify(s, null, 2);
  const tStr = JSON.stringify(t, null, 2);

  if (sStr !== tStr) throw new Error(`${key} mismatch: \n ${sStr} \n ${tStr}`);

  console.log(`\n${'-'.repeat(40)}\n${key} : \n ${JSON.stringify(s)} \n ${JSON.stringify(t)} \n\n${'-'.repeat(40)}`);

  return true;
}

function checkName (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'name');
}

function checkPayable (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'payable');
}

function checkInputs (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'inputs');
}
function checkConstant (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'constant');
}

function checkType (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'type');
}
function checkStateMutability (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'stateMutability');
}
function checkOutputs (interfaceABI = [], implementationABI = []) {
  return _checkKey(interfaceABI, implementationABI, 'outputs');
}

const PAD_LENGTH = 25;

console.log('checkImplementation'.padEnd(PAD_LENGTH), checkImplementation(interfaceABI, implementationABI));
console.log('');

console.log('checkConstant'.padEnd(PAD_LENGTH), checkConstant(interfaceABI, implementationABI));
console.log('checkInputs'.padEnd(PAD_LENGTH), checkInputs(interfaceABI, implementationABI));
console.log('checkName'.padEnd(PAD_LENGTH), checkName(interfaceABI, implementationABI));
console.log('checkOutputs'.padEnd(PAD_LENGTH), checkOutputs(interfaceABI, implementationABI));
console.log('checkPayable'.padEnd(PAD_LENGTH), checkPayable(interfaceABI, implementationABI));
console.log('checkStateMutability'.padEnd(PAD_LENGTH), checkStateMutability(interfaceABI, implementationABI));
console.log('checkType'.padEnd(PAD_LENGTH), checkType(interfaceABI, implementationABI));
