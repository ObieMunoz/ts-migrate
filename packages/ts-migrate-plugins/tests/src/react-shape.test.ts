import reactShapePlugin from '../../src/plugins/react-shape';
import { caseReader, mockPluginParams } from '../test-utils';

const readCase = caseReader('react-shape');

describe('react-shape plugin', () => {
  it('add types and change default import of the simple shape', async () => {
    const text = `import PropTypes from 'prop-types';
export default PropTypes.shape({
  test: PropTypes.string,
  bedrooms: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
});
`;
    const result = await reactShapePlugin.run(mockPluginParams({ text, fileName: 'MyShape.js' }));
    expect(result).toBe(`import PropTypes from 'prop-types';

type MyShape = {
    test?: string;
    bedrooms?: number | string;
};
const MyShape: PropTypes.Requireable<MyShape> = PropTypes.shape({
    test: PropTypes.string,
    bedrooms: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
});
export default MyShape;
`);
  });

  it('shape as a variable, exports after declaration', async () => {
    const text = `import PropTypes from 'prop-types';
const BestShape = PropTypes.shape({
  test: PropTypes.string,
});
export default BestShape;
`;

    const result = await reactShapePlugin.run(mockPluginParams({ text, fileName: 'BestShape.js' }));
    expect(result).toBe(`import PropTypes from 'prop-types';

type BestShape = {
    test?: string;
};
const BestShape: PropTypes.Requireable<BestShape> = PropTypes.shape({
    test: PropTypes.string,
});
export default BestShape;
`);
  });

  it('shape as a variable, exports declaration', async () => {
    const text = `import PropTypes from 'prop-types';
export const BestShape = PropTypes.shape({
  test: PropTypes.string,
});
`;

    const result = await reactShapePlugin.run(mockPluginParams({ text, fileName: 'BestShape.js' }));
    expect(result).toBe(`import PropTypes from 'prop-types';

type BestShape = {
    test?: string;
};
const BestShape: PropTypes.Requireable<BestShape> = PropTypes.shape({
    test: PropTypes.string,
});
export { BestShape };
`);
  });

  it('exports declaration preceded by a comment containing "export"', async () => {
    const text = `import PropTypes from 'prop-types';
// eslint-disable-next-line import/prefer-default-export
export const BestShape = PropTypes.shape({
  test: PropTypes.string,
});
`;

    const result = await reactShapePlugin.run(mockPluginParams({ text, fileName: 'BestShape.js' }));
    expect(result).toBe(`import PropTypes from 'prop-types';

type BestShape = {
    test?: string;
};
// eslint-disable-next-line import/prefer-default-export
const BestShape: PropTypes.Requireable<BestShape> = PropTypes.shape({
    test: PropTypes.string,
});
export { BestShape };
`);
  });

  it('extract default import from react-validators Shape', async () => {
    const text = `import { Shape, Types } from 'react-validators';

    export default Shape({
      to_link: Types.string,
      title: Types.string,
      subtitle: Types.string,
    });
`;

    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'LandingCardsShape.js' }),
    );
    expect(result).toBe(`import PropTypes from "prop-types";
import { Shape, Types } from 'react-validators';

type LandingCardsShape = {
    to_link?: string;
    title?: string;
    subtitle?: string;
};
const LandingCardsShape: PropTypes.Requireable<LandingCardsShape> = Shape({
    to_link: Types.string,
    title: Types.string,
    subtitle: Types.string,
});
export default LandingCardsShape;
`);
  });

  it('complex shape with shape inside', async () => {
    const text = `import PropTypes from 'prop-types';

export default PropTypes.shape({
  price_amount: PropTypes.shape({
    amount: PropTypes.number.isRequired,
    currency: PropTypes.string.isRequired,
    micros_amount: PropTypes.number,
  }),
  amount_formatted: PropTypes.string,
});`;

    const result = await reactShapePlugin.run(mockPluginParams({ text, fileName: 'MyShape.js' }));
    expect(result).toBe(`import PropTypes from 'prop-types';

type MyShape = {
    price_amount?: {
        amount: number;
        currency: string;
        micros_amount?: number;
    };
    amount_formatted?: string;
};
const MyShape: PropTypes.Requireable<MyShape> = PropTypes.shape({
    price_amount: PropTypes.shape({
        amount: PropTypes.number.isRequired,
        currency: PropTypes.string.isRequired,
        micros_amount: PropTypes.number,
    }),
    amount_formatted: PropTypes.string,
});
export default MyShape;`);
  });

  it('imported shape as a field', async () => {
    const text = `import PropTypes from 'prop-types';
import ReviewShape from './ReviewShape';
import UserShape from ':shapes/UserShape';

export default PropTypes.shape({
  reviews: PropTypes.arrayOf(ReviewShape),
  review: ReviewShape,
  user: UserShape.requires(\`
    first_name,
    picture_url,
  \`),
});`;

    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'MyShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import PropTypes from 'prop-types';
import ReviewShape from './ReviewShape';
import UserShape from ':shapes/UserShape';

type MyShape = {
    reviews?: ReviewShape[];
    review?: ReviewShape;
    user?: $TSFixMe; // TODO: UserShape.requires(\` first_name, picture_url, \`)
};
const MyShape: PropTypes.Requireable<MyShape> = PropTypes.shape({
    reviews: PropTypes.arrayOf(ReviewShape),
    review: ReviewShape,
    user: UserShape.requires(\`
    first_name,
    picture_url,
  \`),
});
export default MyShape;`);
  });

  it('array of the shapes', async () => {
    const text = `import PropTypes from 'prop-types';

const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
    caption: PropTypes.string,
  }),
);
export default ArrayShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'ArrayShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import PropTypes from 'prop-types';

type ArrayShape = {
    picture: string;
    caption?: string;
}[];

const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
    caption: PropTypes.string,
  }),
);
export default ArrayShape;`);
  });

  it('array of the shapes with an existing type', async () => {
    const text = `import PropTypes from 'prop-types';

type ArrayShape = {
    picture: string;
    caption?: string;
}[];

const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
    caption: PropTypes.string,
  }),
);
export default ArrayShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'ArrayShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(text);
  });

  it('array of the shapes with an existing interface', async () => {
    const text = `import PropTypes from 'prop-types';

interface ArrayShape {
  picture: string;
}

const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
  }),
);
export default ArrayShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'ArrayShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(text);
  });

  it('leaves its own output for an array of the shapes alone on a second run', async () => {
    const text = `import PropTypes from 'prop-types';

export const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
    caption: PropTypes.string,
  }),
);`;
    const params = { fileName: 'ArrayShape.js', options: { anyAlias: '$TSFixMe' } };
    const first = await reactShapePlugin.run(mockPluginParams({ ...params, text }));
    expect(first).toBe(`import PropTypes from 'prop-types';

type ArrayShape = {
    picture: string;
    caption?: string;
}[];

const ArrayShape = PropTypes.arrayOf(
  PropTypes.shape({
    picture: PropTypes.string.isRequired,
    caption: PropTypes.string,
  }),
);
export { ArrayShape };`);

    const second = await reactShapePlugin.run(mockPluginParams({ ...params, text: first! }));
    expect(second).toBe(first);
  });

  it('complex exports, multiple variables shapes', async () => {
    const text = `import { Shape, Types } from 'react-validators';

const addressFields = ['street', 'apt', 'city', 'state', 'country_code', 'zipcode'];

export const AddressFormDataShape = Shape({
  fields: Types.arrayOf(Types.oneOf(addressFields)),
  requiredFields: Types.arrayOf(Types.oneOf(addressFields)),
  placeholders: Types.object,
});

export const CountriesShape = Types.arrayOf(Types.arrayOf(Types.string));

export default Types.shape({
  addressFormData: Types.objectOf(AddressFormDataShape),
  allAddressFormFields: Types.arrayOf(Types.oneOf(addressFields)),
  countries: CountriesShape.isRequired,
  hostRecipients: Types.arrayOf(Types.object),
});`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'MyShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import PropTypes from "prop-types";
import { Shape, Types } from 'react-validators';

type MyShape = {
    addressFormData?: {
        [key: string]: AddressFormDataShape;
    };
    allAddressFormFields?: $TSFixMe[]; // TODO: Types.oneOf(addressFields)
    countries: CountriesShape;
    hostRecipients?: $TSFixMe[];
};

const addressFields = ['street', 'apt', 'city', 'state', 'country_code', 'zipcode'];

type AddressFormDataShape = {
    fields?: $TSFixMe[]; // TODO: Types.oneOf(addressFields)
    requiredFields?: $TSFixMe[]; // TODO: Types.oneOf(addressFields)
    placeholders?: $TSFixMe;
};

const AddressFormDataShape: PropTypes.Requireable<AddressFormDataShape> = Shape({
    fields: Types.arrayOf(Types.oneOf(addressFields)),
    requiredFields: Types.arrayOf(Types.oneOf(addressFields)),
    placeholders: Types.object,
});
export { AddressFormDataShape };

export const CountriesShape = Types.arrayOf(Types.arrayOf(Types.string));
const MyShape: PropTypes.Requireable<MyShape> = Types.shape({
    addressFormData: Types.objectOf(AddressFormDataShape),
    allAddressFormFields: Types.arrayOf(Types.oneOf(addressFields)),
    countries: CountriesShape.isRequired,
    hostRecipients: Types.arrayOf(Types.object),
});
export default MyShape;`);
  });

  it('pass variable object to the shape', async () => {
    const text = `import { Shape, Types } from 'react-validators';

export const ListingSizePropTypes = {
  min_bathrooms: Types.number,
  min_bedrooms: Types.number,
  min_beds: Types.number,
};
export const SomeShape = Shape(ListingSizePropTypes);
export default Shape(ListingSizePropTypes);`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'MyShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import { Shape, Types } from 'react-validators';

export const ListingSizePropTypes = {
  min_bathrooms: Types.number,
  min_bedrooms: Types.number,
  min_beds: Types.number,
};
export const SomeShape = Shape(ListingSizePropTypes);
export default Shape(ListingSizePropTypes);`);
  });

  it('add PropTypes.Requireable to the variable shape', async () => {
    const text = `import { Shape, Types } from 'react-validators';

import RoomShape from './RoomShape';

const FloorShape = Shape({
  id: Types.number,
  name: Types.string,
  rooms: Types.arrayOf(RoomShape),
});

export default FloorShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'MyShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import PropTypes from "prop-types";
import { Shape, Types } from 'react-validators';

import RoomShape from './RoomShape';

type FloorShape = {
    id?: number;
    name?: string;
    rooms?: RoomShape[];
};

const FloorShape: PropTypes.Requireable<FloorShape> = Shape({
    id: Types.number,
    name: Types.string,
    rooms: Types.arrayOf(RoomShape),
});

export default FloorShape;`);
  });

  it('shape which already have a type', async () => {
    const text = `import PropTypes from 'prop-types';

type MyShape = {
    test?: string;
    bedrooms?: number | string;
};
const MyShape: PropTypes.Requireable<MyShape> = PropTypes.shape({
    test: PropTypes.string,
    bedrooms: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
});
export default MyShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({ text, fileName: 'MyShape.js', options: { anyAlias: '$TSFixMe' } }),
    );
    expect(result).toBe(`import PropTypes from 'prop-types';

type MyShape = {
    test?: string;
    bedrooms?: number | string;
};
const MyShape: PropTypes.Requireable<MyShape> = PropTypes.shape({
    test: PropTypes.string,
    bedrooms: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
});
export default MyShape;`);
  });

  it('shape with an existing interface', async () => {
    const text = `import PropTypes from 'prop-types';

const DateShape = PropTypes.shape({
  publish_date: PropTypes.string.isRequired,
});

interface DateShape {
  publish_date: string;
}

export default DateShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({
        text,
        fileName: 'DateShape.js',
        options: { anyAlias: '$TSFixMe' },
      }),
    );
    expect(result).toBe(`import PropTypes from 'prop-types';

const DateShape: PropTypes.Requireable<DateShape> = PropTypes.shape({
    publish_date: PropTypes.string.isRequired,
});

interface DateShape {
  publish_date: string;
}

export default DateShape;`);
  });

  it('shape with an existing type', async () => {
    const text = `import PropTypes from 'prop-types';
type DateShape = {
  publish_date: string;
};

const DateShape = PropTypes.shape({
  publish_date: PropTypes.string.isRequired,
});

export default DateShape;`;
    const result = await reactShapePlugin.run(
      mockPluginParams({
        text,
        fileName: 'DateShape.js',
        options: { anyAlias: '$TSFixMe' },
      }),
    );
    expect(result).toBe(`import PropTypes from 'prop-types';
type DateShape = {
  publish_date: string;
};

const DateShape: PropTypes.Requireable<DateShape> = PropTypes.shape({
    publish_date: PropTypes.string.isRequired,
});

export default DateShape;`);
  });

  it('do not fail on component or test files', async () => {
    const text = readCase('component-and-test-files.input.js');
    const result = await reactShapePlugin.run(
      mockPluginParams({
        text,
        fileName: 'SomeOtherFile.jsx',
        options: { anyAlias: '$TSFixMe' },
      }),
    );
    expect(result).toBe(readCase('component-and-test-files.expected.js'));
  });
});
