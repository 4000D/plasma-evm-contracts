
/**
 *
 * @param {BaseLoader} DepositManager
 */
function depositEncoder (DepositManager) {
  const contract = (new DepositManager.web3.eth.Contract(DepositManager.abi));

  return function encode () {
    return contract.methods.deposit(...arguments).encodeABI();
  };
};

module.exports = {
  depositEncoder,
};
