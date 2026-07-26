import React from 'react';
import PropTypes from 'prop-types';

const importList = () => {
  function List({ items }) {
    return (
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    );
  }

  List.propTypes = forbidExtraProps({
    ...withRouterPropTypes,
    items: PropTypes.array.isRequired,
  });

  return {
    default: compose(
      withRouter,
      connect(
        (state) => ({ items: state.items }),
        {},
      ),
    )(List),
    UnwrappedList: List,
  };
};

const items = [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }];

describe('deepDive', () => {
  it('dives through render props', () => {
    const { default: List } = importList();
    const Foo = () => <Bar render={() => <List />} />;
    const Bar = ({ render }) => render();

    const wrapper = deepDive(
      shallow(
        <MemoryRouter>
          <Provider store={mockStore({ items })}>
            <Foo />
          </Provider>
        </MemoryRouter>,
      ),
      'List',
    );

    expect(wrapper.find('li')).toHaveLength(items.length);
  });

  it('dives through HOCs that wrap with DOM', () => {
    const Foo = () => <div>Foo</div>;
    const withDom = (Component) => {
      class Wrapper extends React.Component {
        render() {
          return (
            <div>
              <span />
              <Component />
            </div>
          );
        }
      }
      Wrapper.WrappedComponent = Component;
      return Wrapper;
    };
    const Component = withDom(withDom(Foo));
    const wrapper = deepDive(shallow(<Component />), 'Foo');
    const expectedElement = shallow(<Foo />).getElement();
    expect(wrapper.matchesElement(expectedElement)).toBeTruthy();
  });

  it('returns null if not found', () => {
    const Foo = ({ children }) => children;
    const wrapper = deepDive(
      shallow(
        <Foo>
          <section />
        </Foo>,
      ),
      'aside',
    );
    expect(wrapper).toBe(null);
  });
});