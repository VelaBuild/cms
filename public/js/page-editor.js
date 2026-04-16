(function($) {
    'use strict';

    // --- State ---
    var rows = [];
    var editingRowId = null;
    var editingColIndex = null;
    var editingBlockIndex = null;
    var editorJsInstance = null;
    var _idCounter = 1;
    var _slugManuallyEdited = false;

    function uid() { return 'new_' + (_idCounter++); }

    // --- Config (set via window.PageEditorConfig from the view) ---
    function getUploadUrl() {
        return (window.PageEditorConfig && window.PageEditorConfig.uploadUrl)
            ? window.PageEditorConfig.uploadUrl
            : '/admin/pages/ckmedia';
    }

    // --- Init ---
    function init(existingRows) {
        if (existingRows && existingRows.length) {
            rows = parseExistingRows(existingRows);
        }
        renderRows();
        initRowSortable();
        bindFormEvents();
    }

    function parseExistingRows(data) {
        return data.map(function(row) {
            var colMap = {};
            (row.blocks || []).forEach(function(b) {
                var ci = b.column_index || 0;
                if (!colMap[ci]) colMap[ci] = { width: b.column_width || 12, blocks: [] };
                colMap[ci].blocks.push({
                    id: b.id,
                    type: b.type,
                    content: b.content || {},
                    settings: b.settings || {},
                    order: b.order_column || 0
                });
            });
            var columns = [];
            var indices = Object.keys(colMap).map(Number).sort(function(a, b) { return a - b; });
            indices.forEach(function(ci) {
                var col = colMap[ci];
                col.blocks.sort(function(a, b) { return a.order - b.order; });
                columns.push({ width: col.width, blocks: col.blocks });
            });
            if (!columns.length) columns = [{ width: 12, blocks: [] }];
            return {
                id: row.id,
                name: row.name || '',
                css_class: row.css_class || '',
                order: row.order_column || 0,
                columns: columns
            };
        });
    }

    // --- Row Management ---
    function addRow() {
        var newRow = { id: uid(), name: '', css_class: '', order: rows.length, columns: [{ width: 12, blocks: [] }] };
        rows.push(newRow);
        renderRows();
        initRowSortable();
        // Immediately ask for column layout
        openColumnLayoutModal(newRow.id);
    }

    function removeRow(rowId) {
        if (!confirm('Remove this row and all its blocks?')) return;
        rows = rows.filter(function(r) { return r.id != rowId; });
        renderRows();
        initRowSortable();
    }

    function renderRows() {
        var $container = $('#rows-container');
        $container.empty();
        rows.forEach(function(row, ri) {
            $container.append(buildRowHtml(row, ri));
        });
        rows.forEach(function(row) {
            initBlockSortable(row.id);
        });
    }

    function buildRowHtml(row, ri) {
        var colsHtml = '';
        row.columns.forEach(function(col, ci) {
            var blocksHtml = '';
            col.blocks.forEach(function(block, bi) {
                blocksHtml += buildBlockHtml(block, ci, bi);
            });
            var mdWidth = Math.round((col.width / 12) * 12);
            var pctWidth = Math.round((col.width / 12) * 100);
            colsHtml += '<div class="col-md-' + mdWidth + ' page-column-editor" data-col-index="' + ci + '">' +
                '<div class="column-header-label">Col ' + (ci + 1) + ' (' + pctWidth + '%)</div>' +
                '<div class="blocks-sortable" data-row-id="' + row.id + '" data-col-index="' + ci + '">' +
                    blocksHtml +
                '</div>' +
                '<button type="button" class="btn btn-sm btn-outline-success btn-block mt-1 add-block-btn" data-row-id="' + row.id + '" data-col-index="' + ci + '">' +
                    '<i class="fas fa-plus"></i> Add Block' +
                '</button>' +
                '</div>';
        });

        return '<div class="card mb-3 page-row-editor" data-row-id="' + row.id + '">' +
            '<div class="card-header d-flex justify-content-between align-items-center">' +
                '<div class="d-flex align-items-center">' +
                    '<span class="drag-handle mr-2"><i class="fas fa-grip-vertical"></i></span>' +
                    '<input type="text" class="form-control form-control-sm row-name-input" placeholder="Row name (optional)" value="' + escHtml(row.name) + '" style="width:200px;" data-row-id="' + row.id + '">' +
                '</div>' +
                '<div>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary column-layout-btn mr-1" data-row-id="' + row.id + '" title="Column Layout"><i class="fas fa-columns"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-danger remove-row-btn" data-row-id="' + row.id + '" title="Remove Row"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="card-body py-2">' +
                '<div class="row">' + colsHtml + '</div>' +
            '</div>' +
        '</div>';
    }

    var blockTypeIcons = {
        text: 'fa-font', image: 'fa-image', video: 'fa-video',
        html: 'fa-code', accordion: 'fa-list-ul', contact_form: 'fa-envelope', carousel: 'fa-images', gallery: 'fa-th', testimonials: 'fa-quote-right', icon_box: 'fa-icons'
    };
    var blockTypeLabels = {
        text: 'Text', image: 'Image', video: 'Video',
        html: 'Custom HTML', accordion: 'Accordion Q&A', contact_form: 'Contact Form', carousel: 'Carousel Slider', gallery: 'Image Gallery', testimonials: 'Testimonials', icon_box: 'Icon Box'
    };

    function buildBlockHtml(block, ci, bi) {
        var icon = blockTypeIcons[block.type] || 'fa-cube';
        var label = blockTypeLabels[block.type] || block.type;
        var preview = getBlockPreview(block);
        return '<div class="page-block-editor-item" data-col-index="' + ci + '" data-block-index="' + bi + '">' +
            '<div class="block-header">' +
                '<small class="drag-handle"><i class="fas fa-grip-vertical mr-1"></i></small>' +
                '<small><i class="fas ' + icon + '"></i> ' + label + '</small>' +
                '<div>' +
                    '<button type="button" class="btn btn-xs btn-info edit-block-btn" title="Edit"><i class="fas fa-edit"></i></button> ' +
                    '<button type="button" class="btn btn-xs btn-warning duplicate-block-btn" title="Duplicate"><i class="fas fa-copy"></i></button> ' +
                    '<button type="button" class="btn btn-xs btn-danger remove-block-btn" title="Remove"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="block-preview-text">' + preview + '</div>' +
        '</div>';
    }

    function getBlockPreview(block) {
        if (block.type === 'text') {
            var blocks = (block.content && block.content.blocks) ? block.content.blocks : [];
            if (!blocks.length) return '<em>Empty text block</em>';
            var html = '';
            blocks.forEach(function(b) {
                if (!b.data) return;
                var t = b.type || '';
                var text = b.data.text || '';
                if (t === 'paragraph') {
                    html += '<p>' + text + '</p>';
                } else if (t === 'header') {
                    var level = b.data.level || 2;
                    html += '<h' + level + '>' + text + '</h' + level + '>';
                } else if (t === 'list') {
                    var tag = (b.data.style === 'ordered') ? 'ol' : 'ul';
                    var items = (b.data.items || []);
                    html += '<' + tag + '>' + items.map(function(i) { return '<li>' + (typeof i === 'string' ? i : (i.content || '')) + '</li>'; }).join('') + '</' + tag + '>';
                } else if (t === 'quote') {
                    html += '<blockquote>' + text + '</blockquote>';
                } else if (t === 'table') {
                    var rows = b.data.content || [];
                    html += '<table>' + rows.map(function(r) { return '<tr>' + (r || []).map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
                } else if (t === 'image') {
                    html += '<img src="' + escHtml(b.data.file && b.data.file.url ? b.data.file.url : '') + '" style="max-width:100%;">';
                } else {
                    html += '<p>' + text + '</p>';
                }
            });
            return '<div class="admin-preview-text">' + html + '</div>';
        }
        if (block.type === 'image') {
            var url = block.content && block.content.url ? block.content.url : '';
            if (!url) return '<em>No image set</em>';
            var caption = block.content && block.content.caption ? block.content.caption : '';
            return '<div><img src="' + escHtml(url) + '" style="max-width:100%;max-height:200px;border-radius:4px;">' +
                (caption ? '<div style="font-size:0.85em;color:#555;margin-top:4px;">' + escHtml(caption) + '</div>' : '') + '</div>';
        }
        if (block.type === 'video') {
            var videoUrl = (block.content && block.content.url) ? block.content.url : '';
            if (!videoUrl) return '<em>No URL set</em>';
            var embedUrl = '';
            var ytMatch = videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            var viMatch = videoUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
            if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1];
            else if (viMatch) embedUrl = 'https://player.vimeo.com/video/' + viMatch[1];
            if (embedUrl) {
                return '<div style="max-width:400px;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">' +
                    '<iframe src="' + escHtml(embedUrl) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div>';
            }
            return escHtml(videoUrl);
        }
        if (block.type === 'html') {
            var htmlContent = (block.content && block.content.html) ? block.content.html : '';
            return '<div style="border:1px solid #e9ecef;border-radius:4px;padding:8px;background:#fafafa;">' + htmlContent + '</div>';
        }
        if (block.type === 'accordion') {
            var items = (block.content && block.content.items) ? block.content.items : [];
            var settings = block.content && block.content.settings ? block.content.settings : {};
            if (!items.length) return '<em>No accordion items</em>';
            var accHtml = '';
            items.forEach(function(item, idx) {
                var isOpen = (idx === 0 && settings.first_open);
                var bodyStyle = isOpen
                    ? 'max-height:2000px;padding:10px 15px;overflow:hidden;transition:max-height 0.3s ease,padding 0.3s ease;'
                    : 'max-height:0;overflow:hidden;transition:max-height 0.3s ease,padding 0.3s ease;padding:0 15px;';
                var chevronStyle = isOpen ? 'transform:rotate(180deg);transition:transform 0.3s;' : 'transition:transform 0.3s;';
                var itemClass = 'admin-acc-item' + (isOpen ? ' open' : '');
                accHtml += '<div class="' + itemClass + '">' +
                    '<div class="admin-acc-header" style="padding:10px 15px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:2px;font-weight:500;font-size:0.9em;">' +
                        '<span>' + escHtml(item.title || '') + '</span>' +
                        '<svg class="admin-acc-chevron" style="' + chevronStyle + '" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                    '</div>' +
                    '<div class="admin-acc-body" style="' + bodyStyle + '">' + (item.content || '') + '</div>' +
                '</div>';
            });
            return accHtml;
        }
        if (block.type === 'contact_form') {
            var fields = block.content && block.content.fields ? block.content.fields : {};
            var fieldNames = ['name', 'email', 'phone', 'subject', 'message'];
            var formHtml = '<div style="font-size:0.85em;">';
            fieldNames.forEach(function(f) {
                if (fields[f] === false) return;
                formHtml += '<div style="margin-bottom:6px;"><label style="display:block;font-weight:500;">' + escHtml(f.charAt(0).toUpperCase() + f.slice(1)) + '</label>';
                if (f === 'message') {
                    formHtml += '<textarea disabled style="width:100%;border:1px solid #dee2e6;border-radius:3px;padding:4px 6px;background:#f8f9fa;resize:none;" rows="2"></textarea>';
                } else {
                    formHtml += '<input type="text" disabled style="width:100%;border:1px solid #dee2e6;border-radius:3px;padding:4px 6px;background:#f8f9fa;">';
                }
                formHtml += '</div>';
            });
            formHtml += '<button disabled style="background:#007bff;color:#fff;border:none;padding:6px 16px;border-radius:3px;opacity:0.7;">Submit</button></div>';
            return formHtml;
        }
        if (block.type === 'carousel') {
            var slides = block.content && block.content.slides ? block.content.slides : [];
            if (!slides.length) return '<em class="text-muted">No slides added</em>';
            var stripHtml = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
            slides.forEach(function(slide) {
                if (slide.image_url) {
                    stripHtml += '<img src="' + escHtml(slide.image_url) + '" style="height:80px;border-radius:4px;object-fit:cover;">';
                } else {
                    stripHtml += '<div style="height:80px;width:80px;background:#e9ecef;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.75em;color:#6c757d;">No image</div>';
                }
            });
            stripHtml += '</div><div style="font-size:0.85em;color:#555;margin-top:4px;">' + slides.length + ' slide' + (slides.length !== 1 ? 's' : '') + '</div>';
            return stripHtml;
        }
        if (block.type === 'gallery') {
            var images = block.content && block.content.images ? block.content.images : [];
            if (!images.length) return '<em class="text-muted">No images added</em>';
            var cols = block.settings && block.settings.columns ? block.settings.columns : 3;
            var gridHtml = '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:4px;">';
            images.forEach(function(img) {
                if (img.url) {
                    gridHtml += '<img src="' + escHtml(img.url) + '" style="height:60px;object-fit:cover;border-radius:3px;">';
                } else {
                    gridHtml += '<div style="height:60px;background:#e9ecef;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:0.7em;color:#6c757d;">No image</div>';
                }
            });
            gridHtml += '</div><div style="font-size:0.85em;color:#555;margin-top:4px;">' + images.length + ' image' + (images.length !== 1 ? 's' : '') + '</div>';
            return gridHtml;
        }
        if (block.type === 'testimonials') {
            var testimonials = block.content && block.content.testimonials ? block.content.testimonials : [];
            if (!testimonials.length) return '<em class="text-muted">No testimonials added</em>';
            var cardsHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
            testimonials.forEach(function(t) {
                var quote = t.quote || '';
                var truncated = quote.length > 100 ? quote.substring(0, 100) + '...' : quote;
                cardsHtml += '<div style="border-left:3px solid #3b82f6;padding:8px 12px;background:#f9fafb;border-radius:4px;min-width:180px;max-width:260px;flex:1;">';
                cardsHtml += '<div style="font-style:italic;font-size:0.85em;color:#374151;margin-bottom:6px;">' + escHtml(truncated) + '</div>';
                cardsHtml += '<div style="display:flex;align-items:center;gap:6px;">';
                if (t.photo_url) {
                    cardsHtml += '<img src="' + escHtml(t.photo_url) + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">';
                }
                cardsHtml += '<span style="font-weight:600;font-size:0.8em;">' + escHtml(t.name || '') + '</span>';
                if (t.title) cardsHtml += '<span style="font-size:0.75em;color:#6b7280;">' + escHtml(t.title) + '</span>';
                cardsHtml += '</div></div>';
            });
            cardsHtml += '</div>';
            return cardsHtml;
        }
        if (block.type === 'icon_box') {
            var items = block.content && block.content.items ? block.content.items : [];
            if (!items.length) return '<em class="text-muted">No icon boxes added</em>';
            var cols = block.settings && block.settings.columns ? block.settings.columns : 3;
            var gridCols = Math.min(cols, items.length);
            var ibHtml = '<div style="display:grid;grid-template-columns:repeat(' + gridCols + ',1fr);gap:8px;">';
            items.forEach(function(item) {
                var desc = item.description || '';
                var truncDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
                ibHtml += '<div style="text-align:center;padding:10px 8px;background:#f9fafb;border-radius:4px;">';
                ibHtml += '<i class="' + escHtml(item.icon || 'fas fa-star') + '" style="font-size:1.5em;color:#3b82f6;margin-bottom:6px;display:block;"></i>';
                ibHtml += '<div style="font-weight:600;font-size:0.85em;margin-bottom:4px;">' + escHtml(item.title || '') + '</div>';
                ibHtml += '<div style="font-size:0.78em;color:#6b7280;">' + escHtml(truncDesc) + '</div>';
                ibHtml += '</div>';
            });
            ibHtml += '</div>';
            return ibHtml;
        }
        return '';
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Sortable ---
    function initRowSortable() {
        var el = document.getElementById('rows-container');
        if (el && el._sortable) el._sortable.destroy();
        if (!el) return;
        var s = Sortable.create(el, {
            handle: '.drag-handle',
            animation: 150,
            onEnd: function(evt) {
                var moved = rows.splice(evt.oldIndex, 1)[0];
                rows.splice(evt.newIndex, 0, moved);
                rows.forEach(function(r, i) { r.order = i; });
            }
        });
        el._sortable = s;
    }

    function initBlockSortable(rowId) {
        var row = getRow(rowId);
        if (!row) return;
        row.columns.forEach(function(col, ci) {
            var el = document.querySelector('[data-row-id="' + rowId + '"][data-col-index="' + ci + '"].blocks-sortable');
            if (!el) return;
            if (el._sortable) el._sortable.destroy();
            var s = Sortable.create(el, {
                handle: '.drag-handle',
                animation: 150,
                group: 'blocks-' + rowId,
                onEnd: function(evt) {
                    var fromCi = parseInt(evt.from.getAttribute('data-col-index'));
                    var toCi = parseInt(evt.to.getAttribute('data-col-index'));
                    var block = row.columns[fromCi].blocks.splice(evt.oldIndex, 1)[0];
                    row.columns[toCi].blocks.splice(evt.newIndex, 0, block);
                    row.columns[toCi].blocks.forEach(function(b, i) { b.order = i; });
                    if (fromCi !== toCi) {
                        row.columns[fromCi].blocks.forEach(function(b, i) { b.order = i; });
                    }
                    renderRows();
                    initRowSortable();
                }
            });
            el._sortable = s;
        });
    }

    // --- Block management ---
    function getRow(rowId) {
        return rows.find(function(r) { return r.id == rowId; });
    }

    function removeBlock(rowId, colIndex, blockIndex) {
        var row = getRow(rowId);
        if (!row || !confirm('Remove this block?')) return;
        row.columns[colIndex].blocks.splice(blockIndex, 1);
        renderRows();
        initRowSortable();
    }

    function duplicateBlock(rowId, colIndex, blockIndex) {
        var row = getRow(rowId);
        if (!row) return;
        var block = row.columns[colIndex].blocks[blockIndex];
        var copy = JSON.parse(JSON.stringify(block));
        copy.id = uid();
        copy.order = row.columns[colIndex].blocks.length;
        row.columns[colIndex].blocks.splice(blockIndex + 1, 0, copy);
        renderRows();
        initRowSortable();
    }

    // --- Column Layout ---
    var _layoutTargetRowId = null;
    function openColumnLayoutModal(rowId) {
        _layoutTargetRowId = rowId;
        $('#column-layout-modal').modal('show');
    }

    function setColumnLayout(rowId, widths) {
        var row = getRow(rowId);
        if (!row) return;
        var allBlocks = [];
        row.columns.forEach(function(c) { allBlocks = allBlocks.concat(c.blocks); });
        row.columns = widths.map(function(w) { return { width: w, blocks: [] }; });
        allBlocks.forEach(function(b, i) { row.columns[i % widths.length].blocks.push(b); });
        renderRows();
        initRowSortable();
    }

    // --- Edit Modal ---
    function openEditModal(rowId, colIndex, blockIndex) {
        var row = getRow(rowId);
        if (!row) return;
        var block = row.columns[colIndex].blocks[blockIndex];
        if (!block) return;
        editingRowId = rowId;
        editingColIndex = colIndex;
        editingBlockIndex = blockIndex;
        var html = '';
        if (block.type === 'text') { html = renderTextEditor(block); }
        else if (block.type === 'image') { html = renderImageEditor(block); }
        else if (block.type === 'video') { html = renderVideoEditor(block); }
        else if (block.type === 'html') { html = renderHtmlEditor(block); }
        else if (block.type === 'accordion') { html = renderAccordionEditor(block); }
        else if (block.type === 'contact_form') { html = renderContactFormEditor(block); }
        else if (block.type === 'carousel') { html = renderCarouselEditor(block); }
        else if (block.type === 'gallery') { html = renderGalleryEditor(block); }
        else if (block.type === 'testimonials') { html = renderTestimonialsEditor(block); }
        else if (block.type === 'icon_box') { html = renderIconBoxEditor(block); }
        $('.modal-title').text('Edit Block: ' + (blockTypeLabels[block.type] || block.type));
        $('#block-edit-content').html(html);
        if (block.type === 'text') { initEditorJS(block); }
        if (block.type === 'accordion') { initAccordionEditor(block); }
        if (block.type === 'image') { initBlockImageDropzone(); }
        if (block.type === 'carousel') { initCarouselEditor(block); }
        if (block.type === 'gallery') { initGalleryEditor(block); }
        if (block.type === 'testimonials') { initTestimonialsEditor(block); }
        if (block.type === 'icon_box') { initIconBoxEditor(block); }
        $('#block-edit-modal').modal('show');
    }

    function renderTextEditor(block) {
        return '<div id="block-editorjs" style="border:1px solid #ced4da;border-radius:4px;min-height:200px;padding:8px;"></div>';
    }

    function initEditorJS(block) {
        if (editorJsInstance) { try { editorJsInstance.destroy(); } catch(e) {} editorJsInstance = null; }
        var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        var uploadUrl = getUploadUrl();
        var data = block.content && block.content.blocks ? block.content : { blocks: [] };
        editorJsInstance = new EditorJS({
            holder: 'block-editorjs',
            data: data,
            tools: {
                header: Header,
                list: List,
                quote: Quote,
                table: Table,
                embed: Embed,
                image: {
                    class: ImageTool,
                    config: {
                        uploader: {
                            uploadByFile: function(file) {
                                var formData = new FormData();
                                formData.append('upload', file);
                                formData.append('crud_id', 0);
                                return fetch(uploadUrl, {
                                    method: 'POST',
                                    headers: { 'X-CSRF-TOKEN': csrf },
                                    body: formData
                                }).then(function(r) { return r.json(); }).then(function(resp) {
                                    if (resp && resp.url) return { success: 1, file: { url: resp.url } };
                                    return Promise.reject('Upload failed');
                                });
                            }
                        }
                    }
                }
            }
        });
    }

    function renderImageEditor(block) {
        var url = block.content && block.content.url ? block.content.url : '';
        var alt = block.content && block.content.alt ? block.content.alt : '';
        var caption = block.content && block.content.caption ? block.content.caption : '';
        var link = block.settings && block.settings.link ? block.settings.link : '';
        var maxWidth = block.settings && block.settings.max_width ? block.settings.max_width : '100%';
        return '<div class="form-group"><label>Image URL</label>' +
            '<div class="needsclick block-img-dz" id="block-image-dropzone"></div>' +
            '<small class="text-muted">Or enter URL manually:</small>' +
            '<input type="text" class="form-control mt-1" id="img-url" value="' + escHtml(url) + '" placeholder="https://...">' +
            (url ? '<div class="mt-2"><img src="' + escHtml(url) + '" style="max-height:100px;border-radius:4px;"></div>' : '') +
            '</div>' +
            '<div class="form-group"><label>Alt Text</label><input type="text" class="form-control" id="img-alt" value="' + escHtml(alt) + '"></div>' +
            '<div class="form-group"><label>Caption</label><input type="text" class="form-control" id="img-caption" value="' + escHtml(caption) + '"></div>' +
            '<div class="form-group"><label>Link URL (optional)</label><input type="text" class="form-control" id="img-link" value="' + escHtml(link) + '"></div>' +
            '<div class="form-group"><label>Max Width</label><input type="text" class="form-control" id="img-maxwidth" value="' + escHtml(maxWidth) + '" placeholder="100%"></div>';
    }

    function renderVideoEditor(block) {
        var url = block.content && block.content.url ? block.content.url : '';
        return '<div class="form-group"><label>Video URL</label>' +
            '<input type="text" class="form-control" id="video-url" value="' + escHtml(url) + '" placeholder="https://www.youtube.com/watch?v=...">' +
            '<small class="text-muted">Paste a YouTube or Vimeo URL</small></div>' +
            '<div id="video-preview" class="mt-2">' + getVideoPreviewHtml(url) + '</div>';
    }

    function getVideoPreviewHtml(url) {
        var embedUrl = '';
        var ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        var viMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1];
        else if (viMatch) embedUrl = 'https://player.vimeo.com/video/' + viMatch[1];
        if (!embedUrl) return '';
        return '<div style="position:relative;padding-bottom:56.25%;height:0;"><iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe></div>';
    }

    function renderHtmlEditor(block) {
        var html = block.content && block.content.html ? block.content.html : '';
        return '<div class="form-group"><label>Custom HTML</label>' +
            '<div class="alert alert-warning py-1 mb-2"><small><i class="fas fa-exclamation-triangle"></i> This content will be rendered as-is. Use with caution.</small></div>' +
            '<textarea class="form-control" id="html-content" rows="10" style="font-family:monospace;">' + escHtml(html) + '</textarea></div>';
    }

    function renderAccordionEditor(block) {
        var items = block.content && block.content.items ? block.content.items : [];
        var firstOpen = block.settings && typeof block.settings.first_open !== 'undefined' ? block.settings.first_open : true;
        var itemsHtml = '';
        items.forEach(function(item, i) {
            itemsHtml += buildAccordionItemRow(item, i);
        });
        return '<div id="accordion-items-list">' + itemsHtml + '</div>' +
            '<button type="button" class="btn btn-sm btn-success mt-2" id="add-accordion-item">+ Add Item</button>' +
            '<div class="form-check mt-3">' +
                '<input type="checkbox" class="form-check-input" id="accordion-first-open"' + (firstOpen ? ' checked' : '') + '>' +
                '<label class="form-check-label" for="accordion-first-open">First item expanded by default</label>' +
            '</div>';
    }

    function buildAccordionItemRow(item, i) {
        return '<div class="accordion-item-row">' +
            '<div style="flex:1;">' +
                '<input type="text" class="form-control form-control-sm mb-1 acc-title" placeholder="Question / Title" value="' + escHtml(item.title || '') + '">' +
                '<textarea class="form-control form-control-sm acc-body" rows="2" placeholder="Answer / Body">' + escHtml(item.body || '') + '</textarea>' +
            '</div>' +
            '<button type="button" class="btn btn-xs btn-danger remove-accordion-item" data-index="' + i + '"><i class="fas fa-trash"></i></button>' +
        '</div>';
    }

    function initAccordionEditor(block) {
        $(document).off('click', '#add-accordion-item').on('click', '#add-accordion-item', function() {
            var $list = $('#accordion-items-list');
            var count = $list.find('.accordion-item-row').length;
            $list.append(buildAccordionItemRow({ title: '', body: '' }, count));
        });
        $(document).off('click', '.remove-accordion-item').on('click', '.remove-accordion-item', function() {
            $(this).closest('.accordion-item-row').remove();
        });
    }

    function initBlockImageDropzone() {
        var el = document.getElementById('block-image-dropzone');
        if (!el) return;
        var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        var uploadUrl = getUploadUrl();
        new Dropzone(el, {
            url: uploadUrl,
            maxFilesize: 20,
            acceptedFiles: '.jpeg,.jpg,.png,.gif,.webp',
            maxFiles: 1,
            addRemoveLinks: true,
            headers: { 'X-CSRF-TOKEN': csrf },
            paramName: 'upload',
            params: { crud_id: 0 },
            success: function(file, response) {
                if (response && response.url) {
                    $('#img-url').val(response.url);
                }
            },
            removedfile: function(file) {
                file.previewElement.remove();
                this.options.maxFiles = this.options.maxFiles + 1;
            },
            error: function(file, response) {
                var message = (typeof response === 'string') ? response : (response.errors ? response.errors.file : 'Upload failed');
                file.previewElement.classList.add('dz-error');
                var refs = file.previewElement.querySelectorAll('[data-dz-errormessage]');
                for (var i = 0; i < refs.length; i++) { refs[i].textContent = message; }
            }
        });
    }

    function renderContactFormEditor(block) {
        var settings = block.settings || {};
        var fields = settings.fields || {
            name: { enabled: true, required: true },
            email: { enabled: true, required: true },
            phone: { enabled: true, required: false },
            subject: { enabled: true, required: false },
            message: { enabled: true, required: true }
        };
        var submitLabel = settings.submit_label || 'Send Message';
        var successMessage = settings.success_message || 'Thank you for your message!';
        var fieldNames = ['name', 'email', 'phone', 'subject', 'message'];
        var tableRows = fieldNames.map(function(f) {
            var fd = fields[f] || { enabled: false, required: false };
            return '<tr><td>' + f.charAt(0).toUpperCase() + f.slice(1) + '</td>' +
                '<td><input type="checkbox" class="cf-enabled" data-field="' + f + '"' + (fd.enabled ? ' checked' : '') + '></td>' +
                '<td><input type="checkbox" class="cf-required" data-field="' + f + '"' + (fd.required ? ' checked' : '') + '></td></tr>';
        }).join('');
        return '<table class="table table-sm"><thead><tr><th>Field</th><th>Enabled</th><th>Required</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
            '<div class="form-group"><label>Submit Button Label</label><input type="text" class="form-control" id="cf-submit-label" value="' + escHtml(submitLabel) + '"></div>' +
            '<div class="form-group"><label>Success Message</label><input type="text" class="form-control" id="cf-success-msg" value="' + escHtml(successMessage) + '"></div>';
    }

    function renderCarouselEditor(block) {
        var slides = block.content && block.content.slides ? block.content.slides : [];
        var settings = block.settings || {};
        var autoplay = typeof settings.autoplay !== 'undefined' ? settings.autoplay : true;
        var interval = typeof settings.interval !== 'undefined' ? settings.interval : 5000;
        var showArrows = typeof settings.show_arrows !== 'undefined' ? settings.show_arrows : true;
        var showDots = typeof settings.show_dots !== 'undefined' ? settings.show_dots : true;
        var slidesHtml = '';
        slides.forEach(function(slide, i) {
            slidesHtml += buildCarouselSlideRow(slide, i);
        });
        return '<div id="carousel-slides-list">' + slidesHtml + '</div>' +
            '<button type="button" class="btn btn-sm btn-success mt-2" id="add-carousel-slide">+ Add Slide</button>' +
            '<hr>' +
            '<div class="form-check">' +
                '<input type="checkbox" class="form-check-input" id="carousel-autoplay"' + (autoplay ? ' checked' : '') + '>' +
                '<label class="form-check-label" for="carousel-autoplay">Autoplay</label>' +
            '</div>' +
            '<div class="form-group mt-2"><label>Interval (ms)</label>' +
                '<input type="number" class="form-control" id="carousel-interval" value="' + escHtml(String(interval)) + '" min="500" step="500">' +
            '</div>' +
            '<div class="form-check">' +
                '<input type="checkbox" class="form-check-input" id="carousel-arrows"' + (showArrows ? ' checked' : '') + '>' +
                '<label class="form-check-label" for="carousel-arrows">Show Arrows</label>' +
            '</div>' +
            '<div class="form-check mt-1">' +
                '<input type="checkbox" class="form-check-input" id="carousel-dots"' + (showDots ? ' checked' : '') + '>' +
                '<label class="form-check-label" for="carousel-dots">Show Dots</label>' +
            '</div>';
    }

    function buildCarouselSlideRow(slide, i) {
        return '<div class="carousel-slide-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px;background:#f8f9fa;border-radius:4px;">' +
            '<div style="flex:1;">' +
                '<input type="text" class="form-control form-control-sm mb-1 slide-image" placeholder="Image URL" value="' + escHtml(slide.image_url || '') + '">' +
                '<input type="text" class="form-control form-control-sm mb-1 slide-caption" placeholder="Caption (optional)" value="' + escHtml(slide.caption || '') + '">' +
                '<input type="text" class="form-control form-control-sm slide-link" placeholder="Link URL (optional)" value="' + escHtml(slide.link || '') + '">' +
            '</div>' +
            '<button type="button" class="btn btn-xs btn-danger remove-carousel-slide"><i class="fas fa-trash"></i></button>' +
        '</div>';
    }

    function initCarouselEditor(block) {
        $(document).off('click', '#add-carousel-slide').on('click', '#add-carousel-slide', function() {
            var $list = $('#carousel-slides-list');
            var count = $list.find('.carousel-slide-row').length;
            $list.append(buildCarouselSlideRow({ image_url: '', caption: '', link: '' }, count));
        });
        $(document).off('click', '.remove-carousel-slide').on('click', '.remove-carousel-slide', function() {
            $(this).closest('.carousel-slide-row').remove();
        });
    }

    function renderGalleryEditor(block) {
        var images = block.content && block.content.images ? block.content.images : [];
        var settings = block.settings || {};
        var columns = typeof settings.columns !== 'undefined' ? settings.columns : 3;
        var gap = typeof settings.gap !== 'undefined' ? settings.gap : 10;
        var lightbox = typeof settings.lightbox !== 'undefined' ? settings.lightbox : true;
        var imagesHtml = '';
        images.forEach(function(img, i) {
            imagesHtml += buildGalleryImageRow(img, i);
        });
        return '<div id="gallery-images-list">' + imagesHtml + '</div>' +
            '<button type="button" class="btn btn-sm btn-success mt-2" id="add-gallery-image">+ Add Image</button>' +
            '<hr>' +
            '<div class="form-group mt-2"><label>Columns</label>' +
                '<input type="number" class="form-control" id="gallery-columns" value="' + escHtml(String(columns)) + '" min="1" max="6">' +
            '</div>' +
            '<div class="form-group"><label>Gap (px)</label>' +
                '<input type="number" class="form-control" id="gallery-gap" value="' + escHtml(String(gap)) + '" min="0">' +
            '</div>' +
            '<div class="form-check">' +
                '<input type="checkbox" class="form-check-input" id="gallery-lightbox"' + (lightbox ? ' checked' : '') + '>' +
                '<label class="form-check-label" for="gallery-lightbox">Enable Lightbox</label>' +
            '</div>';
    }

    function buildGalleryImageRow(img, i) {
        return '<div class="gallery-image-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px;background:#f8f9fa;border-radius:4px;">' +
            '<div style="flex:1;">' +
                '<input type="text" class="form-control form-control-sm mb-1 gal-url" placeholder="Image URL" value="' + escHtml(img.url || '') + '">' +
                '<input type="text" class="form-control form-control-sm mb-1 gal-alt" placeholder="Alt text" value="' + escHtml(img.alt || '') + '">' +
                '<input type="text" class="form-control form-control-sm gal-caption" placeholder="Caption (optional)" value="' + escHtml(img.caption || '') + '">' +
            '</div>' +
            '<button type="button" class="btn btn-xs btn-danger remove-gallery-image"><i class="fas fa-trash"></i></button>' +
        '</div>';
    }

    function initGalleryEditor(block) {
        $(document).off('click', '#add-gallery-image').on('click', '#add-gallery-image', function() {
            var $list = $('#gallery-images-list');
            var count = $list.find('.gallery-image-row').length;
            $list.append(buildGalleryImageRow({ url: '', alt: '', caption: '' }, count));
        });
        $(document).off('click', '.remove-gallery-image').on('click', '.remove-gallery-image', function() {
            $(this).closest('.gallery-image-row').remove();
        });
    }

    function renderTestimonialsEditor(block) {
        var testimonials = block.content && block.content.testimonials ? block.content.testimonials : [];
        var testiHtml = '';
        testimonials.forEach(function(t, i) {
            testiHtml += buildTestimonialRow(t, i);
        });
        return '<div id="testimonials-list">' + testiHtml + '</div>' +
            '<button type="button" class="btn btn-sm btn-success mt-2" id="add-testimonial">+ Add Testimonial</button>';
    }

    function buildTestimonialRow(t, i) {
        return '<div class="testi-row" style="margin-bottom:10px;padding:10px;background:#f8f9fa;border-radius:4px;border-left:3px solid #3b82f6;">' +
            '<textarea class="form-control form-control-sm mb-1 testi-quote" rows="3" placeholder="Quote">' + escHtml(t.quote || '') + '</textarea>' +
            '<input type="text" class="form-control form-control-sm mb-1 testi-name" placeholder="Name" value="' + escHtml(t.name || '') + '">' +
            '<input type="text" class="form-control form-control-sm mb-1 testi-title" placeholder="Title / Role" value="' + escHtml(t.title || '') + '">' +
            '<input type="text" class="form-control form-control-sm mb-1 testi-photo" placeholder="Photo URL (optional)" value="' + escHtml(t.photo_url || '') + '">' +
            '<button type="button" class="btn btn-xs btn-danger remove-testimonial"><i class="fas fa-trash"></i> Remove</button>' +
        '</div>';
    }

    function initTestimonialsEditor(block) {
        $(document).off('click', '#add-testimonial').on('click', '#add-testimonial', function() {
            var $list = $('#testimonials-list');
            var count = $list.find('.testi-row').length;
            $list.append(buildTestimonialRow({ quote: '', name: '', title: '', photo_url: '' }, count));
        });
        $(document).off('click', '.remove-testimonial').on('click', '.remove-testimonial', function() {
            $(this).closest('.testi-row').remove();
        });
    }

    function renderIconBoxEditor(block) {
        var items = block.content && block.content.items ? block.content.items : [];
        var columns = block.settings && block.settings.columns ? block.settings.columns : 3;
        var layout = block.settings && block.settings.layout ? block.settings.layout : 'vertical';
        var rowsHtml = '';
        items.forEach(function(item, i) {
            rowsHtml += buildIconBoxRow(item, i);
        });
        return '<div id="iconbox-items-list">' + rowsHtml + '</div>' +
            '<button type="button" class="btn btn-sm btn-success mt-2" id="add-iconbox-item">+ Add Icon Box</button>' +
            '<hr>' +
            '<div class="form-row">' +
                '<div class="form-group col-md-6">' +
                    '<label>Columns</label>' +
                    '<input type="number" class="form-control" id="iconbox-columns" value="' + escHtml(String(columns)) + '" min="1" max="6">' +
                '</div>' +
                '<div class="form-group col-md-6">' +
                    '<label>Layout</label>' +
                    '<select class="form-control" id="iconbox-layout">' +
                        '<option value="vertical"' + (layout === 'vertical' ? ' selected' : '') + '>Vertical (icon on top)</option>' +
                        '<option value="horizontal"' + (layout === 'horizontal' ? ' selected' : '') + '>Horizontal (icon on left)</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<small class="text-muted">Example FA classes: <code>fas fa-star</code>, <code>fas fa-heart</code>, <code>fas fa-globe</code>, <code>fas fa-anchor</code>, <code>fas fa-water</code></small>';
    }

    function buildIconBoxRow(item, i) {
        var icon = item.icon || 'fas fa-star';
        return '<div class="ib-row" style="margin-bottom:10px;padding:10px;background:#f8f9fa;border-radius:4px;border-left:3px solid #3b82f6;">' +
            '<div class="form-row align-items-center mb-2">' +
                '<div class="col-auto">' +
                    '<div class="ib-icon-preview" style="width:40px;height:40px;background:#e8f0fe;border-radius:6px;display:flex;align-items:center;justify-content:center;">' +
                        '<i class="' + escHtml(icon) + '" style="font-size:1.2em;color:#3b82f6;"></i>' +
                    '</div>' +
                '</div>' +
                '<div class="col">' +
                    '<input type="text" class="form-control form-control-sm ib-icon" placeholder="Icon class (e.g. fas fa-star)" value="' + escHtml(icon) + '">' +
                '</div>' +
            '</div>' +
            '<input type="text" class="form-control form-control-sm mb-1 ib-title" placeholder="Title" value="' + escHtml(item.title || '') + '">' +
            '<textarea class="form-control form-control-sm mb-1 ib-desc" rows="2" placeholder="Description">' + escHtml(item.description || '') + '</textarea>' +
            '<button type="button" class="btn btn-xs btn-danger remove-iconbox-item"><i class="fas fa-trash"></i> Remove</button>' +
        '</div>';
    }

    function initIconBoxEditor(block) {
        $(document).off('click', '#add-iconbox-item').on('click', '#add-iconbox-item', function() {
            var $list = $('#iconbox-items-list');
            var count = $list.find('.ib-row').length;
            $list.append(buildIconBoxRow({ icon: 'fas fa-star', title: '', description: '' }, count));
        });
        $(document).off('click', '.remove-iconbox-item').on('click', '.remove-iconbox-item', function() {
            $(this).closest('.ib-row').remove();
        });
        $(document).off('input.ibicon', '.ib-icon').on('input.ibicon', '.ib-icon', function() {
            var val = $(this).val();
            $(this).closest('.ib-row').find('.ib-icon-preview i').attr('class', val);
        });
    }

    // --- Save Block ---
    function saveBlock() {
        var row = getRow(editingRowId);
        if (!row) return;
        var block = row.columns[editingColIndex].blocks[editingBlockIndex];
        if (!block) return;

        if (block.type === 'text') {
            if (editorJsInstance) {
                editorJsInstance.save().then(function(data) {
                    block.content = data;
                    finalizeSave();
                });
                return;
            }
        } else if (block.type === 'image') {
            block.content = {
                url: $('#img-url').val(),
                alt: $('#img-alt').val(),
                caption: $('#img-caption').val()
            };
            block.settings = {
                link: $('#img-link').val(),
                max_width: $('#img-maxwidth').val() || '100%'
            };
        } else if (block.type === 'video') {
            block.content = { url: $('#video-url').val() };
        } else if (block.type === 'html') {
            block.content = { html: $('#html-content').val() };
        } else if (block.type === 'accordion') {
            var items = [];
            $('#accordion-items-list .accordion-item-row').each(function() {
                items.push({
                    title: $(this).find('.acc-title').val(),
                    body: $(this).find('.acc-body').val()
                });
            });
            block.content = { items: items };
            block.settings = { first_open: $('#accordion-first-open').is(':checked') };
        } else if (block.type === 'contact_form') {
            var fieldNames = ['name', 'email', 'phone', 'subject', 'message'];
            var fields = {};
            fieldNames.forEach(function(f) {
                fields[f] = {
                    enabled: $('.cf-enabled[data-field="' + f + '"]').is(':checked'),
                    required: $('.cf-required[data-field="' + f + '"]').is(':checked')
                };
            });
            block.settings = {
                fields: fields,
                submit_label: $('#cf-submit-label').val(),
                success_message: $('#cf-success-msg').val()
            };
        } else if (block.type === 'carousel') {
            var slides = [];
            $('#carousel-slides-list .carousel-slide-row').each(function() {
                slides.push({
                    image_url: $(this).find('.slide-image').val(),
                    caption: $(this).find('.slide-caption').val(),
                    link: $(this).find('.slide-link').val()
                });
            });
            block.content = { slides: slides };
            block.settings = {
                autoplay: $('#carousel-autoplay').is(':checked'),
                interval: parseInt($('#carousel-interval').val()) || 5000,
                show_arrows: $('#carousel-arrows').is(':checked'),
                show_dots: $('#carousel-dots').is(':checked')
            };
        } else if (block.type === 'gallery') {
            var images = [];
            $('#gallery-images-list .gallery-image-row').each(function() {
                images.push({
                    url: $(this).find('.gal-url').val(),
                    alt: $(this).find('.gal-alt').val(),
                    caption: $(this).find('.gal-caption').val()
                });
            });
            block.content = { images: images };
            block.settings = {
                columns: parseInt($('#gallery-columns').val()) || 3,
                gap: parseInt($('#gallery-gap').val()) || 10,
                lightbox: $('#gallery-lightbox').is(':checked')
            };
        } else if (block.type === 'testimonials') {
            var testimonials = [];
            $('#testimonials-list .testi-row').each(function() {
                testimonials.push({
                    quote: $(this).find('.testi-quote').val(),
                    name: $(this).find('.testi-name').val(),
                    title: $(this).find('.testi-title').val(),
                    photo_url: $(this).find('.testi-photo').val()
                });
            });
            block.content = { testimonials: testimonials };
            block.settings = { layout: 'cards' };
        } else if (block.type === 'icon_box') {
            var iconBoxItems = [];
            $('#iconbox-items-list .ib-row').each(function() {
                iconBoxItems.push({
                    icon: $(this).find('.ib-icon').val(),
                    title: $(this).find('.ib-title').val(),
                    description: $(this).find('.ib-desc').val()
                });
            });
            block.content = { items: iconBoxItems };
            block.settings = {
                columns: parseInt($('#iconbox-columns').val()) || 3,
                layout: $('#iconbox-layout').val() || 'vertical'
            };
        }

        finalizeSave();
    }

    function finalizeSave() {
        if (editorJsInstance) { try { editorJsInstance.destroy(); } catch(e) {} editorJsInstance = null; }
        $('#block-edit-modal').modal('hide');
        renderRows();
        initRowSortable();
    }

    // --- Collect Data ---
    function collectData() {
        var data = rows.map(function(row, ri) {
            var blocks = [];
            row.columns.forEach(function(col, ci) {
                col.blocks.forEach(function(block, bi) {
                    blocks.push({
                        id: block.id,
                        column_index: ci,
                        column_width: col.width,
                        order: bi,
                        type: block.type,
                        content: block.content,
                        settings: block.settings
                    });
                });
            });
            return {
                id: row.id,
                name: row.name,
                css_class: row.css_class,
                order: ri,
                blocks: blocks
            };
        });
        return JSON.stringify(data);
    }

    // --- Event Handlers ---
    function bindFormEvents() {
        // Row events
        $(document).on('click', '#add-row-btn', function() { addRow(); });

        $(document).on('click', '.remove-row-btn', function() {
            removeRow($(this).data('row-id'));
        });

        $(document).on('click', '.column-layout-btn', function() {
            openColumnLayoutModal($(this).data('row-id'));
        });

        $(document).on('click', '.layout-btn', function() {
            var widths = $(this).data('widths');
            if (typeof widths === 'string') widths = JSON.parse(widths);
            setColumnLayout(_layoutTargetRowId, widths);
            $('#column-layout-modal').modal('hide');
        });

        // Block events
        $(document).on('click', '.add-block-btn', function() {
            var rowId = $(this).data('row-id');
            var colIndex = parseInt($(this).data('col-index'));
            var html = '<div class="block-type-picker">' +
                '<p class="mb-2"><strong>Choose a block type:</strong></p>' +
                '<div class="d-flex flex-wrap" style="gap:8px;">' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="text"><i class="fas fa-font mr-1"></i>Text</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="image"><i class="fas fa-image mr-1"></i>Image</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="video"><i class="fas fa-video mr-1"></i>Video</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="html"><i class="fas fa-code mr-1"></i>Custom HTML</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="accordion"><i class="fas fa-list-ul mr-1"></i>Accordion Q&A</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="contact_form"><i class="fas fa-envelope mr-1"></i>Contact Form</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="carousel"><i class="fas fa-images mr-1"></i>Carousel</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="gallery"><i class="fas fa-th mr-1"></i>Image Gallery</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="testimonials"><i class="fas fa-quote-right mr-1"></i>Testimonials</button>' +
                '<button class="btn btn-outline-secondary block-type-btn" data-type="icon_box"><i class="fas fa-icons mr-1"></i>Icon Box</button>' +
                '</div></div>';
            $('#block-edit-content').html(html);
            $('#block-edit-modal .modal-title').text('Add Block');
            $('#save-block-btn').hide();
            $(document).off('click.blocktype').on('click.blocktype', '.block-type-btn', function() {
                var type = $(this).data('type');
                $(document).off('click.blocktype');
                // Create the block and swap modal content in-place (no close/reopen)
                var row = getRow(rowId);
                if (!row) return;
                var defaultContent = {}, defaultSettings = {};
                if (type === 'text') { defaultContent = { blocks: [] }; }
                if (type === 'image') { defaultContent = { url: '', alt: '', caption: '' }; defaultSettings = { link: '', max_width: '100%' }; }
                if (type === 'video') { defaultContent = { url: '' }; defaultSettings = { aspect_ratio: '16:9' }; }
                if (type === 'html') { defaultContent = { html: '' }; }
                if (type === 'accordion') { defaultContent = { items: [] }; defaultSettings = { first_open: true }; }
                if (type === 'contact_form') {
                    defaultContent = {};
                    defaultSettings = {
                        fields: {
                            name: { enabled: true, required: true },
                            email: { enabled: true, required: true },
                            phone: { enabled: true, required: false },
                            subject: { enabled: true, required: false },
                            message: { enabled: true, required: true }
                        },
                        submit_label: 'Send Message',
                        success_message: 'Thank you for your message!'
                    };
                }
                if (type === 'carousel') { defaultContent = { slides: [] }; defaultSettings = { autoplay: true, interval: 5000, show_arrows: true, show_dots: true }; }
                if (type === 'gallery') { defaultContent = { images: [] }; defaultSettings = { columns: 3, gap: 10, lightbox: true }; }
                if (type === 'testimonials') { defaultContent = { testimonials: [] }; defaultSettings = { layout: 'cards' }; }
                if (type === 'icon_box') { defaultContent = { items: [] }; defaultSettings = { columns: 3, layout: 'vertical' }; }
                var block = { id: uid(), type: type, content: defaultContent, settings: defaultSettings, order: row.columns[colIndex].blocks.length };
                row.columns[colIndex].blocks.push(block);
                renderRows();
                initRowSortable();
                // Now swap modal content to the edit form (modal stays open)
                var bi = row.columns[colIndex].blocks.length - 1;
                editingRowId = rowId;
                editingColIndex = colIndex;
                editingBlockIndex = bi;
                var editHtml = '';
                if (block.type === 'text') { editHtml = renderTextEditor(block); }
                else if (block.type === 'image') { editHtml = renderImageEditor(block); }
                else if (block.type === 'video') { editHtml = renderVideoEditor(block); }
                else if (block.type === 'html') { editHtml = renderHtmlEditor(block); }
                else if (block.type === 'accordion') { editHtml = renderAccordionEditor(block); }
                else if (block.type === 'contact_form') { editHtml = renderContactFormEditor(block); }
                else if (block.type === 'carousel') { editHtml = renderCarouselEditor(block); }
                else if (block.type === 'gallery') { editHtml = renderGalleryEditor(block); }
                else if (block.type === 'testimonials') { editHtml = renderTestimonialsEditor(block); }
                else if (block.type === 'icon_box') { editHtml = renderIconBoxEditor(block); }
                $('.modal-title').text('Edit Block: ' + (blockTypeLabels[block.type] || block.type));
                $('#block-edit-content').html(editHtml);
                $('#save-block-btn').show();
                if (block.type === 'text') { initEditorJS(block); }
                if (block.type === 'accordion') { initAccordionEditor(block); }
                if (block.type === 'image') { initBlockImageDropzone(); }
                if (block.type === 'carousel') { initCarouselEditor(block); }
                if (block.type === 'gallery') { initGalleryEditor(block); }
                if (block.type === 'testimonials') { initTestimonialsEditor(block); }
                if (block.type === 'icon_box') { initIconBoxEditor(block); }
            });
            $('#block-edit-modal').modal('show');
        });

        $(document).on('click', '.edit-block-btn', function() {
            var $block = $(this).closest('.page-block-editor-item');
            var $sortable = $block.closest('.blocks-sortable');
            var rowId = $sortable.data('row-id');
            var colIndex = parseInt($sortable.data('col-index'));
            var blockIndex = $block.index();
            openEditModal(rowId, colIndex, blockIndex);
        });

        $(document).on('click', '.duplicate-block-btn', function() {
            var $block = $(this).closest('.page-block-editor-item');
            var $sortable = $block.closest('.blocks-sortable');
            var rowId = $sortable.data('row-id');
            var colIndex = parseInt($sortable.data('col-index'));
            var blockIndex = $block.index();
            duplicateBlock(rowId, colIndex, blockIndex);
        });

        $(document).on('click', '.remove-block-btn', function() {
            var $block = $(this).closest('.page-block-editor-item');
            var $sortable = $block.closest('.blocks-sortable');
            var rowId = $sortable.data('row-id');
            var colIndex = parseInt($sortable.data('col-index'));
            var blockIndex = $block.index();
            removeBlock(rowId, colIndex, blockIndex);
        });

        $(document).on('change', '.row-name-input', function() {
            var rowId = $(this).data('row-id');
            var row = getRow(rowId);
            if (row) row.name = $(this).val();
        });

        $(document).on('click', '#save-block-btn', function() { saveBlock(); });

        $(document).on('click', '.admin-acc-header', function(e) {
            e.stopPropagation();
            var $item = $(this).closest('.admin-acc-item');
            var $body = $item.find('.admin-acc-body');
            var $chevron = $item.find('.admin-acc-chevron');
            var isOpen = $item.hasClass('open');
            if (isOpen) {
                $item.removeClass('open');
                $body.css({'max-height': '0', 'padding': '0 15px'});
                $chevron.css('transform', 'rotate(0deg)');
            } else {
                $item.addClass('open');
                $body.css({'max-height': '2000px', 'padding': '10px 15px'});
                $chevron.css('transform', 'rotate(180deg)');
            }
        });

        $(document).on('input', '#video-url', function() {
            $('#video-preview').html(getVideoPreviewHtml($(this).val()));
        });

        $('#block-edit-modal').on('hidden.bs.modal', function() {
            if (editorJsInstance) { try { editorJsInstance.destroy(); } catch(e) {} editorJsInstance = null; }
            $('#save-block-btn').show();
        });

        // Auto-slug generation (only if slug not manually edited)
        $('#slug').on('input', function() {
            _slugManuallyEdited = true;
        });

        $('#title').on('input', function() {
            if (_slugManuallyEdited) return;
            var slug = $(this).val().toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            $('#slug').val(slug);
        });

        // Form submit: serialize rows to hidden input
        $('#page-form').on('submit', function() {
            $('#rows-json').val(collectData());
        });
    }

    // Expose public API
    window.PageEditor = { init: init };

})(jQuery);
