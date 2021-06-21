/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module list/listediting
 */

import ListCommand from './listcommand';
import IndentCommand from './indentcommand';

import { Plugin } from 'ckeditor5/src/core';
import { Enter } from 'ckeditor5/src/enter';
import { Delete } from 'ckeditor5/src/typing';

import {
	modelIndentPasteFixer,
	viewToModelPosition, isList
} from './converters';
import { createViewListItemElement } from './utils';

/**
 * The engine of the list feature. It handles creating, editing and removing lists and list items.
 *
 * It registers the `'numberedList'`, `'bulletedList'`, `'indentList'` and `'outdentList'` commands.
 *
 * @extends module:core/plugin~Plugin
 */
export default class ListEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'ListEditing';
	}

	/**
	 * @inheritDoc
	 */
	static get requires() {
		return [ Enter, Delete ];
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;

		editor.model.schema.extend( '$block', {
			allowAttributes: [ 'listIndent', 'listItem' ]
		} );

		// // Schema.
		// // Note: in case `$block` will ever be allowed in `listItem`, keep in mind that this feature
		// // uses `Selection#getSelectedBlocks()` without any additional processing to obtain all selected list items.
		// // If there are blocks allowed inside list item, algorithms using `getSelectedBlocks()` will have to be modified.
		// editor.model.schema.register( 'listItem', {
		// 	inheritAllFrom: '$block',
		// 	allowAttributes: [ 'listType', 'listIndent' ]
		// } );

		// Converters.
		const data = editor.data;
		const editing = editor.editing;
		const view = editing.view;

		// editor.model.document.registerPostFixer( writer => modelChangePostFixer( editor.model, writer ) );

		editing.mapper.registerViewToModelLength( 'li', getViewListItemLength );
		editing.mapper.registerViewToModelLength( 'ul', getViewListItemLength );
		editing.mapper.registerViewToModelLength( 'ol', getViewListItemLength );
		data.mapper.registerViewToModelLength( 'li', getViewListItemLength );
		data.mapper.registerViewToModelLength( 'ul', getViewListItemLength );
		data.mapper.registerViewToModelLength( 'ol', getViewListItemLength );

		function getViewListItemLength( element ) {
			let length = 0;

			for ( const child of element.getChildren() ) {
				if ( isList( child ) ) {
					for ( const item of child.getChildren() ) {
						length += getViewListItemLength( item );
					}
				} else {
					length += editing.mapper.getModelLength( child );
				}
			}

			return length;
		}

		editing.mapper.on( 'viewToModelPosition', viewToModelPosition( editor.model ) );
		editing.mapper.on( 'modelToViewPosition', modelToViewPosition );
		data.mapper.on( 'modelToViewPosition', modelToViewPosition );

		function modelToViewPosition( evt, data ) {
			if ( data.isPhantom || data.viewPosition ) {
				return;
			}

			const modelItem = data.modelPosition.nodeAfter;

			if ( !isListItem( modelItem ) ) {
				return;
			}

			const firstModelItem = findFirstSameListItemEntry( modelItem ) || modelItem;
			const viewElement = data.mapper.toViewElement( firstModelItem );

			if ( !viewElement ) {
				return;
			}

			const listView = viewElement.is( 'element', 'li' ) ? viewElement : viewElement.findAncestor( 'li' );

			if ( !listView ) {
				return;
			}

			data.viewPosition = editing.mapper.findPositionIn( listView, data.modelPosition.offset - firstModelItem.startOffset );
		}

		editor.conversion.for( 'downcast' ).rangeToStructure( {
			triggerBy: diffItem => {
				if ( diffItem.name == '$text' ) {
					return;
				}

				const consumables = [];
				let startElement = null;
				let endElement = null;

				switch ( diffItem.type ) {
					case 'attribute': {
						if ( ![ 'listIndent', 'listType', 'listItem' ].includes( diffItem.attributeKey ) ) {
							return;
						}

						const nodeBefore = diffItem.range.start.nodeBefore;
						const nodeAfter = diffItem.range.start.nodeAfter;

						// The attribute was set.
						if ( diffItem.attributeNewValue ) {
							startElement = nodeAfter;
						}
						// The attribute was removed but the previous item has the attribute.
						else if ( isListItem( nodeBefore ) ) {
							startElement = nodeBefore;
							endElement = nodeAfter;
						}
						// The attribute was removed but the element after that has it.
						else if ( isListItem( nodeAfter.nextSibling ) ) {
							startElement = nodeAfter;
							endElement = nodeAfter.nextSibling;
						} else {
							// TODO what if the whole range of elements got listItem attribute removed
							//  this should trigger reconversion but we need to know the range to reconvert
						}

						console.log( 'trigger - attribute change at', diffItem.range.start.path );

						break;
					}

					case 'insert': {
						startElement = diffItem.position.nodeAfter;

						if ( !startElement.hasAttribute( 'listItem' ) ) {
							return;
						}

						console.log( 'trigger - insert at', diffItem.position.path );

						break;
					}

					case 'remove': {
						if ( !diffItem.attributes.has( 'listItem' ) ) {
							return;
						}

						const nodeBefore = diffItem.position.nodeBefore;
						const nodeAfter = diffItem.position.nodeAfter;

						console.log( 'trigger - remove at', diffItem.position.path );

						if ( isListItem( nodeBefore ) ) {
							startElement = nodeBefore;
						} else if ( isListItem( nodeAfter ) ) {
							startElement = nodeAfter;
						} else {
							// Collapsed range to indicate the deletion of the whole structure that starts at that position.
							return {
								type: 'remove',
								range: editor.model.createRange( diffItem.position )
							};
						}

						break;
					}
				}

				if ( !startElement ) {
					return;
				}

				addConsumable( startElement );

				if ( endElement ) {
					addConsumable( endElement );
				} else {
					endElement = startElement;
				}

				let node;

				while ( ( node = startElement.previousSibling ) && isListItem( node ) ) {
					startElement = node;
					addConsumable( node );
				}

				while ( ( node = endElement.nextSibling ) && isListItem( node ) ) {
					endElement = node;
					addConsumable( node );
				}

				const range = editor.model.createRange(
					editor.model.createPositionBefore( startElement ),
					editor.model.createPositionAfter( endElement )
				);

				return {
					range,
					consumables
				};

				function addConsumable( node ) {
					for ( const attribute of [ 'listItem', 'listType', 'listIndent' ] ) {
						if ( node.hasAttribute( attribute ) ) {
							consumables.push( [ node, `attribute:${ attribute }` ] );
						}
					}
				}
			},
			view: ( range, { writer, slotFor } ) => {
				const modelElements = Array.from( range.getItems( { shallow: true } ) );

				if ( !modelElements.length ) {
					return null;
				}

				console.log( 'creating view' );

				const viewLists = [];
				const listType = modelElements[ 0 ].getAttribute( 'listType' ) == 'numbered' ? 'ol' : 'ul';

				let viewList = writer.createContainerElement( listType );

				viewLists.push( viewList );

				// let previousItem = null;

				for ( const modelItem of modelElements ) {
					if ( isListItem( modelItem ) ) {
						const viewItem = createViewListItemElement( writer );

						writer.insert( writer.createPositionAt( viewList, 'end' ), viewItem );
						writer.insert( writer.createPositionAt( viewItem, 0 ), slotFor( modelItem, 'self' ) );
					} else {
						// Some other element that lost it's list item properties.
						viewList = writer.createContainerElement( listType );

						viewLists.push( viewList );

						writer.insert( writer.createPositionAt( viewList, 'end' ), slotFor( modelItem, 'self' ) );
					}

					// const itemModelPosition = editor.model.createPositionBefore( modelItem );
					//
					// // Don't insert ol/ul or li if this is a continuation of some other list item.
					// const isFirstInListItem = !findFirstSameListItemEntry( modelItem );
					//
					// console.log( 'converting', modelItem ); // eslint-disable-line
					//
					// consumable.consume( modelItem, 'attribute:listItem' );
					// consumable.consume( modelItem, 'attribute:listType' );
					// consumable.consume( modelItem, 'attribute:listIndent' );
					//
					// if ( isFirstInListItem ) {
					// 	console.log( 'create list item' ); // eslint-disable-line
					// 	let viewList;
					//
					// 	const listType = modelItem.getAttribute( 'listType' ) == 'numbered' ? 'ol' : 'ul';
					// 	const previousIsListItem = previousItem && previousItem.is( 'element' ) && previousItem.hasAttribute( 'listItem' );
					//
					// 	// First element of the top level list.
					// 	if (
					// 		!previousIsListItem ||
					// 		modelItem.getAttribute( 'listIndent' ) == 0 &&
					// 		previousItem.getAttribute( 'listType' ) != modelItem.getAttribute( 'listType' )
					// 	) {
					// 		viewList = writer.createContainerElement( listType );
					// 		writer.insert( mapper.toViewPosition( itemModelPosition ), viewList );
					// 	}
					//
					// 	// Deeper nested list.
					// 	else if ( previousItem.getAttribute( 'listIndent' ) < modelItem.getAttribute( 'listIndent' ) ) {
					// 		const viewListItem = editing.mapper.toViewElement( previousItem ).findAncestor( 'li' );
					//
					// 		viewList = writer.createContainerElement( listType );
					// 		writer.insert( view.createPositionAt( viewListItem, 'end' ), viewList );
					// 	}
					//
					// 	// Same or shallower level.
					// 	else {
					// 		viewList = editing.mapper.toViewElement( previousItem ).findAncestor( isList );
					//
					// 		for ( let i = 0; i < previousItem.getAttribute( 'listIndent' ) - modelItem.getAttribute( 'listIndent' ); i++ ) {
					// 			viewList = viewList.findAncestor( isList );
					// 		}
					// 	}
					//
					// 	// Inserting the li.
					// 	const viewItem = createViewListItemElement( writer );
					//
					// 	writer.insert( writer.createPositionAt( viewList, 'end' ), viewItem );
					// 	mapper.bindElements( modelItem, viewList );
					// 	mapper.bindElements( modelItem, viewItem );
					//
					// 	writer.insert( writer.createPositionAt( viewItem, 0 ), slotFor( modelItem, 'self' ) );
					// } else {
					// 	writer.insert( mapper.toViewPosition( itemModelPosition ), slotFor( modelItem, 'self' ) );
					// }
					//
					// previousItem = modelItem;
				}

				// TODO should this return a fragment that would consist multiple lists (with slots for elements between lists)?
				//  but how should the mapping be handled then?
				return viewList;
				// return writer.createDocumentFragment( viewLists );
			}
		} );

		// editor.conversion.for( 'downcast' ).add( dispatcher => {
		// 	dispatcher.on( 'insert', ( evt, data, { consumable, writer, mapper } ) => {
		// 		if (
		// 			!consumable.test( data.item, 'attribute:listItem' ) ||
		// 			!consumable.test( data.item, 'attribute:listType' ) ||
		// 			!consumable.test( data.item, 'attribute:listIndent' )
		// 		) {
		// 			return;
		// 		}
		//
		// 		const modelItem = data.item;
		// 		const previousItem = modelItem.previousSibling;
		//
		// 		// Don't insert ol/ul or li if this is a continuation of some other list item.
		// 		const isFirstInListItem = !findFirstSameListItemEntry( modelItem );
		//
		// 		console.log( 'converting', modelItem ); // eslint-disable-line
		//
		// 		consumable.consume( modelItem, 'attribute:listItem' );
		// 		consumable.consume( modelItem, 'attribute:listType' );
		// 		consumable.consume( modelItem, 'attribute:listIndent' );
		//
		// 		let contentViewPosition;
		//
		// 		// Get the previously converted list item content element.
		// 		const viewChildContent = mapper.toViewElement( modelItem );
		//
		// 		if ( isFirstInListItem ) {
		// 			console.log( 'create list item' ); // eslint-disable-line
		// 			let viewList;
		//
		// 			const listType = modelItem.getAttribute( 'listType' ) == 'numbered' ? 'ol' : 'ul';
		// 			const previousIsListItem = previousItem && previousItem.is( 'element' ) && previousItem.hasAttribute( 'listItem' );
		//
		// 			// First element of the top level list.
		// 			if (
		// 				!previousIsListItem ||
		// 				modelItem.getAttribute( 'listIndent' ) == 0 &&
		// 				previousItem.getAttribute( 'listType' ) != modelItem.getAttribute( 'listType' )
		// 			) {
		// 				viewList = writer.createContainerElement( listType );
		// 				writer.insert( mapper.toViewPosition( data.range.start ), viewList );
		// 			}
		//
		// 			// Deeper nested list.
		// 			else if ( previousItem.getAttribute( 'listIndent' ) < modelItem.getAttribute( 'listIndent' ) ) {
		// 				const viewListItem = editing.mapper.toViewElement( previousItem ).findAncestor( 'li' );
		//
		// 				viewList = writer.createContainerElement( listType );
		// 				writer.insert( view.createPositionAt( viewListItem, 'end' ), viewList );
		// 			}
		//
		// 			// Same or shallower level.
		// 			else {
		// 				viewList = editing.mapper.toViewElement( previousItem ).findAncestor( isList );
		//
		// 				for ( let i = 0; i < previousItem.getAttribute( 'listIndent' ) - modelItem.getAttribute( 'listIndent' ); i++ ) {
		// 					viewList = viewList.findAncestor( isList );
		// 				}
		// 			}
		//
		// 			// Inserting the li.
		// 			const viewItem = createViewListItemElement( writer );
		//
		// 			writer.insert( writer.createPositionAt( viewList, 'end' ), viewItem );
		// 			mapper.bindElements( modelItem, viewList );
		// 			mapper.bindElements( modelItem, viewItem );
		//
		// 			contentViewPosition = writer.createPositionAt( viewItem, 0 );
		// 		} else {
		// 			contentViewPosition = mapper.toViewPosition( data.range.start );
		// 		}
		//
		// 		// The content of this list item was already converted before so just insert it into the new list item.
		// 		if ( viewChildContent ) {
		// 			writer.insert( contentViewPosition, viewChildContent );
		// 			mapper.bindElements( modelItem, viewChildContent );
		//
		// 			evt.stop();
		// 		}
		//
		// 		// Let the list item content get converted.
		// 	}, { priority: 'high' } );
		// } );

		// editor.conversion.for( 'editingDowncast' )
		// 	.add( dispatcher => {
		// 		dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
		// 		dispatcher.on( 'insert:listItem', modelViewInsertion( editor.model ) );
		// 		dispatcher.on( 'attribute:listType:listItem', modelViewChangeType, { priority: 'high' } );
		// 		dispatcher.on( 'attribute:listType:listItem', modelViewMergeAfterChangeType, { priority: 'low' } );
		// 		dispatcher.on( 'attribute:listIndent:listItem', modelViewChangeIndent( editor.model ) );
		// 		dispatcher.on( 'remove:listItem', modelViewRemove( editor.model ) );
		// 		dispatcher.on( 'remove', modelViewMergeAfter, { priority: 'low' } );
		// 	} );

		// editor.conversion.for( 'dataDowncast' )
		// 	.add( dispatcher => {
		// 		dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
		// 		dispatcher.on( 'insert:listItem', modelViewInsertion( editor.model ) );
		// 	} );
		//
		// editor.conversion.for( 'upcast' )
		// 	.add( dispatcher => {
		// 		dispatcher.on( 'element:ul', cleanList, { priority: 'high' } );
		// 		dispatcher.on( 'element:ol', cleanList, { priority: 'high' } );
		// 		dispatcher.on( 'element:li', cleanListItem, { priority: 'high' } );
		// 		dispatcher.on( 'element:li', viewModelConverter );
		// 	} );

		// Fix indentation of pasted items.
		editor.model.on( 'insertContent', modelIndentPasteFixer, { priority: 'high' } );

		// Register commands for numbered and bulleted list.
		editor.commands.add( 'numberedList', new ListCommand( editor, 'numbered' ) );
		editor.commands.add( 'bulletedList', new ListCommand( editor, 'bulleted' ) );

		// Register commands for indenting.
		editor.commands.add( 'indentList', new IndentCommand( editor, 'forward' ) );
		editor.commands.add( 'outdentList', new IndentCommand( editor, 'backward' ) );

		const viewDocument = editing.view.document;

		// Overwrite default Enter key behavior.
		// If Enter key is pressed with selection collapsed in empty list item, outdent it instead of breaking it.
		this.listenTo( viewDocument, 'enter', ( evt, data ) => {
			const doc = this.editor.model.document;
			const positionParent = doc.selection.getLastPosition().parent;

			if ( doc.selection.isCollapsed && positionParent.name == 'listItem' && positionParent.isEmpty ) {
				this.editor.execute( 'outdentList' );

				data.preventDefault();
				evt.stop();
			}
		}, { context: 'li' } );

		// Overwrite default Backspace key behavior.
		// If Backspace key is pressed with selection collapsed on first position in first list item, outdent it. #83
		this.listenTo( viewDocument, 'delete', ( evt, data ) => {
			// Check conditions from those that require less computations like those immediately available.
			if ( data.direction !== 'backward' ) {
				return;
			}

			const selection = this.editor.model.document.selection;

			if ( !selection.isCollapsed ) {
				return;
			}

			const firstPosition = selection.getFirstPosition();

			if ( !firstPosition.isAtStart ) {
				return;
			}

			const positionParent = firstPosition.parent;

			if ( positionParent.name !== 'listItem' ) {
				return;
			}

			const previousIsAListItem = positionParent.previousSibling && positionParent.previousSibling.name === 'listItem';

			if ( previousIsAListItem ) {
				return;
			}

			this.editor.execute( 'outdentList' );

			data.preventDefault();
			evt.stop();
		}, { context: 'li' } );

		const getCommandExecuter = commandName => {
			return ( data, cancel ) => {
				const command = this.editor.commands.get( commandName );

				if ( command.isEnabled ) {
					this.editor.execute( commandName );
					cancel();
				}
			};
		};

		editor.keystrokes.set( 'Tab', getCommandExecuter( 'indentList' ) );
		editor.keystrokes.set( 'Shift+Tab', getCommandExecuter( 'outdentList' ) );
	}

	/**
	 * @inheritDoc
	 */
	afterInit() {
		const commands = this.editor.commands;

		const indent = commands.get( 'indent' );
		const outdent = commands.get( 'outdent' );

		if ( indent ) {
			indent.registerChildCommand( commands.get( 'indentList' ) );
		}

		if ( outdent ) {
			outdent.registerChildCommand( commands.get( 'outdentList' ) );
		}
	}
}

function findFirstSameListItemEntry( modelItem ) {
	let node = modelItem.previousSibling;

	// Find closest node with the same listItem attribute.
	while (
		node && node.is( 'element' ) && node.hasAttribute( 'listItem' ) &&
		node.getAttribute( 'listItem' ) != modelItem.getAttribute( 'listItem' )
	) {
		node = node.previousSibling;
	}

	if ( !node || !node.is( 'element' ) || node.getAttribute( 'listItem' ) != modelItem.getAttribute( 'listItem' ) ) {
		return null;
	}

	// Find farthest one.
	let previous = null;

	while (
		( previous = node.previousSibling ) && previous.is( 'element' ) &&
		previous.getAttribute( 'listItem' ) == modelItem.getAttribute( 'listItem' )
	) {
		node = previous;
	}

	return node;
}

function isListItem( node ) {
	return !!node && node.is( 'element' ) && node.hasAttribute( 'listItem' );
}
