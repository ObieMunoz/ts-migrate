import alt from '../alt';
import {} from ':someImport';

const initialState = {
  // Address sanitization state
  flagA: false,
  flagB: false,
  flagC: false,
  flagD: null,
  flagA: null,

  // Pin drag state
  SomeValues1: false,
  SomeValues2: false,
  SomeValues3: {},
  SomeValues4: false,
  SomeValues5: false,
  SomeValues6: null,
  SomeValues7: null,
  SomeValues8: null,
  SomeValues9: {},
};

function computeInitialState({ A }: $TSFixMe) {
  const notCountry = L10n.a() !== 'A';
  return {
    // address precision flags should be true for all users outside of China
    flagA: notCountry,
    flagB: notCountry,
    flagC: notCountry,
    flagD: false,
    flagA: notCountry ? 250 : null,
  };
}

function onDeserialize(data: $TSFixMe) {
  return {
    ...initialState,
    ...computeInitialState(data),
  };
}

/**
 * comment
 */
class Store {
  static config: $TSFixMe;

  bindActions: $TSFixMe;

  setState: $TSFixMe;

  state: $TSFixMe;

  constructor() {
    this.state = {
      ...initialState,
    };
    this.bindActions({});
  }

  methodA(center: $TSFixMe) {
    this.setState({ flagA: center });
  }

  methodB(A: $TSFixMe) {
    this.setState({ A });
  }

  methodC(param: $TSFixMe) {
    this.setState({ param });
  }

  methodD(param: $TSFixMe) {
    this.setState({ param });
  }

  methodF(param: $TSFixMe) {
    if (param) {
      this.methodG(true);
    } else {
      this.methodA(false);
    }

    this.setState({ param });
  }

  methodG(param: $TSFixMe) {
    this.setState({ param });
  }

  methodAA(param: $TSFixMe) {
    this.setState({ F: false });
  }

  methodAB() {
    this.setState({ A: null });
  }

  renderA() {
    this.setState({ flagB: true });
  }

  hideA() {
    this.setState({
      flagA: false,
      flagB: null,
    });
  }

  changeA(_: $TSFixMe) {
    this.setState({
      flagA: false,
      flagB: true,
    });
  }

  backA() {
    this.setState({
      flagA: true,
      flagD: null,
    });
  }

  backB() {
    this.setState({
      foo: true,
    });
  }
}

Store.config = { onDeserialize };
export default alt.createStore(Store, 'Store');
