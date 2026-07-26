import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

const SIZES = {
  LARGE: 'large',
  JUMBO: 'jumbo',
};

type OwnAddEmailWidgetProps = {
    email?: string;
};

const defaultProps = {
  onSubmit() {},
  onImpression() {},
  onFinished() {},
  onError() {},
  size: SIZES.LARGE,
};

const INPUT_CLASS = {
  large: 'input-large',
  jumbo: 'input-jumbo',
};

const BTN_CLASS = {
  large: 'btn-large',
  jumbo: 'btn-jumbo',
};

type OwnUpdatedEmailProps = {
    size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
    email: string;
};

type UpdatedEmailProps = WithDefaultProps<OwnUpdatedEmailProps, (typeof UpdatedEmail)["defaultProps"]>;

function UpdatedEmail({ size }: UpdatedEmailProps) {
  // @ts-ignore ts-migrate(7017) FIXME: Element implicitly has an 'any' type because type ... Remove this comment to see the full error message
  const inputClass = INPUT_CLASS[size];
  return <div className="row email-update-form" />;
}

UpdatedEmail.defaultProps = {
  size: SIZES.LARGE,
};

type OwnEmailFormProps = {
    size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
    status?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(EmailUpdateStatuses))
    email?: string;
    errorMessage?: string;
    onChangedInput: $TSFixMeFunction;
    onClickSubmit: $TSFixMeFunction;
};

type EmailFormProps = WithDefaultProps<OwnEmailFormProps, (typeof EmailForm)["defaultProps"]>;

function EmailForm({ size, status }: EmailFormProps) {
  const inputClass = INPUT_CLASS[size];
  const btnClass = BTN_CLASS[size];

  return <div />;
}

EmailForm.defaultProps = {
  size: SIZES.LARGE,
  errorMessage: null,
  email: null,
  status: 'EmailUpdateStatuses.AWAITING_INPUT',
};

type AddEmailWidgetProps = WithDefaultProps<OwnAddEmailWidgetProps, typeof defaultProps>;

class AddEmailWidget extends React.Component<AddEmailWidgetProps> {
  static defaultProps = defaultProps;

  constructor(props: AddEmailWidgetProps) {
    super(props);
  }

  render() {
    const { status, email, size } = this.props;

    if (status === 'EmailUpdateStatuses.SUCCESS') {
      return <div />;
    }
    return <div />;
  }
}

export default AddEmailWidget;
