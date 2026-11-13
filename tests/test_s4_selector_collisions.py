"""S4-0091-04: the selector-collision inventory comes from the real sheets and stays current."""

from selecta.audit import selector_collisions as sc


def test_the_inventory_in_docs_is_up_to_date():
    assert sc.OUT.read_text("utf-8") == sc.markdown(), (
        "run: python -m selecta.audit.selector_collisions --write"
    )


def test_it_reads_every_shared_sheet_in_load_order():
    order = sc.load_order()
    assert order[0] == "style.css"
    assert order[-1] == "styles/typography.css"
    assert "styles/tokens.css" not in order


def test_every_repeated_class_has_a_proposed_owner_that_styles_it():
    _, classes, owners = sc.inventory()
    assert set(owners) == set(classes)
    for name, sheets in classes.items():
        assert owners[name] in sheets


def test_the_register_shared_classes_are_in_the_inventory():
    _, classes, owners = sc.inventory()
    for name in ("card", "panel", "row", "display", "count", "song", "seam"):
        assert name in classes, name
    assert owners["card"] == "style.css"
    assert owners["song"] == "style.css"


def test_a_comma_list_and_a_pseudo_class_list_split_correctly():
    assert sc._split(".a, :is(.b, .c) .d") == [".a", " :is(.b, .c) .d"]
    assert sc._subject(".timeline .song") == ".song"
