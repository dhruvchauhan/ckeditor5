/**
 * @license Copyright (c) 2003-2018, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

const DecoupledDocumentEditor = require( '../../build/ckeditor' );
const editorData = `<h2>About CKEditor&nbsp;5</h2>

<p>This is <a href="https://ckeditor.com">CKEditor&nbsp;5</a>.</p>

<figure class="image">
	<img src="./sample.jpg" alt="Autumn fields" />
</figure>

<p>After more than 2 years of building the next generation editor from scratch and closing over 980 tickets,
we created a highly <strong>extensible and flexible architecture</strong> which consists of an <strong>amazing
editing framework</strong> and <strong>editing solutions</strong> that will be built on top of it.</p>

<p>We explained this design choice in
<a href="https://medium.com/content-uneditable/ckeditor-5-the-future-of-rich-text-editing-2b9300f9df2c">&ldquo;CKEditor 5:
The future of rich text editing&ldquo;</a>:</p>

<blockquote><p>(…) we are changing our approach with CKEditor 5. We will no longer have only two solutions
available, instead CKEditor will be seen as a framework for editing solutions. At the same time, we will be
developing several out-of-the-box solutions based on it, which will be available to use in many different contexts.
It will be a real “one size fits all” approach, from little requirements, to super advanced full featured
applications.</p></blockquote>

<h3>Notes</h3>

<p><a href="https://ckeditor.com">CKEditor&nbsp;5</a> is <i>under heavy development</i> and this demo
is not production-ready software. For example:</p>

<ul>
	<li><strong>Only Chrome, Opera and Safari are supported</strong>.</li>
	<li>Firefox requires enabling the
	<a href="https://developer.mozilla.org/en-US/docs/Web/API/Document/onselectionchange">
	&ldquo;dom.select_events.enabled&rdquo;</a> option.</li>
	<li><a href="https://github.com/ckeditor/ckeditor5/issues/342">Support for pasting</a>
	is under development (content filtering is unstable).</li>
</ul>

<p>It has <em>bugs</em> that we are aware of &mdash; and that we will be working on in the next few
iterations of the project. Stay tuned for some updates soon!</p>`;

DecoupledDocumentEditor
	.create( editorData, {
		toolbarContainer: document.querySelector( '.toolbar-container' ),
		editableContainer: document.querySelector( '.editable-container' )
	} )
	.then( editor => {
		window.editor = editor;
	} )
	.catch( err => {
		console.error( err.stack );
	} );
