import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type Props = {
  activeRouteName?: string;
  isSaving: boolean;
  lastSavedTimeStamp?: number;
  listingId: number | string;
  logLYSExitMethod: (
    activeRouteName: string | undefined,
    listingId: string | number,
    method: string,
  ) => void;
  onSaveAndExit: () => void;
  setHeadingRef?: () => void;
  step?: number;
  stepTitle?: string;
};

type PrivateProps = Props & WithStylesProps;

const defaultProps = {
  activeRouteName: '',
  setHeadingRef() {},
  lastSavedTimeStamp: null,
  listingId: null,
  onSaveAndExit() {},
  stepTitle: '',
};

class Navbar extends React.Component<PrivateProps> {
  static defaultProps = defaultProps;

  constructor(props: PrivateProps) {
    super(props);
  }

  render() {
    const {
      css,
      isSaving,
      lastSavedTimeStamp,
      listingId,
      setHeadingRef,
      step,
      stepTitle,
      styles,
    } = this.props;

    return <div {...css(styles.airbnbHeader)} />;
  }
}

export default withStyles(({ color, responsive }) => ({
  airbnbHeader: {
    width: '100%',
  },
}))(Navbar);