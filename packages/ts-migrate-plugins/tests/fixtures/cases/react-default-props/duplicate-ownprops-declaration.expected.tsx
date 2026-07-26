
import React from 'react';
import PropTypes from 'prop-types';
type State = {
  expanded: boolean;
};
interface OwnProps {
  onSelectInstallmentFee: (value: number) => Promise<any>;
  renderLayout: RenderLayout | null;
  isCheckoutPlatform?: boolean;
}

type OwnInstallmentSelectorProps = InstallmentFeesSelectorProps & OwnProps & WithLoggingContextProps;

type Props = (OwnInstallmentSelectorProps & typeof InstallmentSelector.defaultProps);
class InstallmentSelector extends React.Component<Props, State> {
  static propTypes = {
    InstallmentFees: PropTypes.arrayOf(InstallmentFeeShape).isRequired,
    eligible: PropTypes.bool.isRequired,
    fetchInstallmentFees: PropTypes.func.isRequired,
    gibraltarInstrumentType: EGibraltarInstrumentTypeShape,
    onSelectInstallmentFee: PropTypes.func.isRequired,
    productPriceQuoteToken: PropTypes.string,
    renderLayout: PropTypes.func,
    selectInstallmentFee: PropTypes.func.isRequired,
    selectedBInstallmentFeeCount: PropTypes.number.isRequired,
    wrapWithLoading: PropTypes.func.isRequired,
  };
  static defaultProps = {
    renderLayout: null,
  };
  constructor(props: Props) {
    super(props);
    this.state = {
      expanded: false,
    };
    this.onChange = this.onChange.bind(this);
  }
  componentDidMount() {
  }
  componentDidUpdate(prevProps: Props) {
  }
  onChange(numStr: string) {}
  render() {
    return Component;
  }
}
export default InstallmentSelector;
