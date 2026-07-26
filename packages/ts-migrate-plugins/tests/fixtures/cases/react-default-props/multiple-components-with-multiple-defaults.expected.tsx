import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type OwnTrElementProps = {
    children: React.ReactNode;
    onClick?: $TSFixMeFunction;
    onMouseEnter?: $TSFixMeFunction;
    onMouseLeave?: $TSFixMeFunction;
    role?: string;
    tabIndex?: string;
    strongAccentOnHover?: boolean;
};

const trDefaultProps = {
  onClick: null,
  onMouseEnter: null,
  onMouseLeave: null,
  role: null,
  tabIndex: null,
  strongAccentOnHover: false,
};

type TrElementProps = WithDefaultProps<OwnTrElementProps, typeof trDefaultProps> & WithStylesProps;

const TrElement = ({
  css,
  styles,
  children,
  onClick,
  role,
  tabIndex,
  onMouseEnter,
  onMouseLeave,
  strongAccentOnHover,
}: TrElementProps) => (
  <tr
    {...css(
      onClick && styles.tr_clickable,
      strongAccentOnHover && styles.tr_strong_accent_on_hover,
    )}
    onClick={onClick}
    role={role}
    // @ts-ignore ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
    tabIndex={tabIndex}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {children}
  </tr>
);
TrElement.defaultProps = trDefaultProps;

export const Tr = withStyles(({ color }) => ({
  tr_clickable: {
    ':hover': {
      cursor: 'pointer',
      backgroundColor: color.accent.bgGray,
    },
  },
  tr_strong_accent_on_hover: {
    ':hover': {
      color: color.white,
      backgroundColor: color.core.babu,
    },
  },
}))(TrElement);