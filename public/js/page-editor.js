// --- PageEditor Plugin Registry ---
// Must be set up before the IIFE so third-party code can call registerBlockType
// before the editor initializes.
window.PageEditor = window.PageEditor || {};
PageEditor.blockTypes = {};

PageEditor.registerBlockType = function(name, config) {
    // config: { icon, label, defaults, renderPreview(block), renderEditor(block), initEditor(block), collectData(block) }
    PageEditor.blockTypes[name] = config;
};

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

    function getMediaUrl() {
        return (window.PageEditorConfig && window.PageEditorConfig.mediaUrl)
            ? window.PageEditorConfig.mediaUrl
            : '/admin/media';
    }

    function getMediaUploadUrl() {
        return (window.PageEditorConfig && window.PageEditorConfig.mediaUploadUrl)
            ? window.PageEditorConfig.mediaUploadUrl
            : '/admin/media/media';
    }

    // --- Helper ---
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Internal helpers used by built-in block types ---

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

    // --- Media Browser ---
    var _mediaBrowserCallback = null;
    var _mediaBrowserCursor = null;
    var _mediaBrowserLoading = false;
    var _mediaBrowserDone = false;

    function openMediaBrowser(callback) {
        _mediaBrowserCallback = callback;
        _mediaBrowserCursor = null;
        _mediaBrowserDone = false;
        _mediaBrowserLoading = false;
        $('#media-browser-grid').empty();
        $('#media-browser-empty').hide();
        loadMediaBrowserPage();
        $('#media-browser-modal').modal('show');
    }

    function loadMediaBrowserPage() {
        if (_mediaBrowserLoading || _mediaBrowserDone) return;
        _mediaBrowserLoading = true;
        $('#media-browser-loading').show();
        var url = getMediaUrl() + '?per_page=36';
        if (_mediaBrowserCursor) url += '&cursor=' + _mediaBrowserCursor;
        fetch(url, { headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.data.length === 0 && !_mediaBrowserCursor) {
                    $('#media-browser-empty').show();
                }
                data.data.forEach(function(item) {
                    var thumb = item.preview || item.thumb || item.url;
                    var alt = (item.custom_properties && item.custom_properties.alt_text) || '';
                    var $el = $('<div class="media-browser-item">')
                        .attr('data-url', item.url)
                        .attr('data-alt', alt)
                        .append($('<img>').attr('src', thumb).attr('alt', item.file_name).attr('loading', 'lazy'))
                        .append($('<div class="media-browser-name">').text(item.file_name));
                    $('#media-browser-grid').append($el);
                });
                _mediaBrowserCursor = data.next_cursor;
                if (!data.next_cursor) _mediaBrowserDone = true;
                _mediaBrowserLoading = false;
                $('#media-browser-loading').hide();
            });
    }

    window.PageEditor.openMediaBrowser = openMediaBrowser;

    function getVideoPreviewHtml(url) {
        var embedUrl = '';
        var ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        var viMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1];
        else if (viMatch) embedUrl = 'https://player.vimeo.com/video/' + viMatch[1];
        if (!embedUrl) return '';
        return '<div style="position:relative;padding-bottom:56.25%;height:0;"><iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe></div>';
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

    function buildCarouselSlideRow(slide, i) {
        return '<div class="carousel-slide-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px;background:#f8f9fa;border-radius:4px;">' +
            '<div style="flex:1;">' +
                '<div class="input-group input-group-sm mb-1"><input type="text" class="form-control slide-image" placeholder="Image URL" value="' + escHtml(slide.image_url || '') + '"><div class="input-group-append"><button type="button" class="btn btn-outline-info browse-media-field" title="Browse Media"><i class="fas fa-images"></i></button></div></div>' +
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

    function buildGalleryImageRow(img, i) {
        return '<div class="gallery-image-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px;background:#f8f9fa;border-radius:4px;">' +
            '<div style="flex:1;">' +
                '<div class="input-group input-group-sm mb-1"><input type="text" class="form-control gal-url" placeholder="Image URL" value="' + escHtml(img.url || '') + '"><div class="input-group-append"><button type="button" class="btn btn-outline-info browse-media-field" title="Browse Media"><i class="fas fa-images"></i></button></div></div>' +
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

    function buildTestimonialRow(t, i) {
        return '<div class="testi-row" style="margin-bottom:10px;padding:10px;background:#f8f9fa;border-radius:4px;border-left:3px solid #3b82f6;">' +
            '<textarea class="form-control form-control-sm mb-1 testi-quote" rows="3" placeholder="Quote">' + escHtml(t.quote || '') + '</textarea>' +
            '<input type="text" class="form-control form-control-sm mb-1 testi-name" placeholder="Name" value="' + escHtml(t.name || '') + '">' +
            '<input type="text" class="form-control form-control-sm mb-1 testi-title" placeholder="Title / Role" value="' + escHtml(t.title || '') + '">' +
            '<div class="input-group input-group-sm mb-1"><input type="text" class="form-control testi-photo" placeholder="Photo URL (optional)" value="' + escHtml(t.photo_url || '') + '"><div class="input-group-append"><button type="button" class="btn btn-outline-info browse-media-field" title="Browse Media"><i class="fas fa-images"></i></button></div></div>' +
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

    // =========================================================================
    // Register built-in block types
    // =========================================================================

    PageEditor.registerBlockType('text', {
        icon: 'fa-font',
        label: 'Text',
        defaults: { content: { blocks: [] }, settings: {} },
        renderPreview: function(block) {
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
                    var trows = b.data.content || [];
                    html += '<table>' + trows.map(function(r) { return '<tr>' + (r || []).map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
                } else if (t === 'image') {
                    html += '<img src="' + escHtml(b.data.file && b.data.file.url ? b.data.file.url : '') + '" style="max-width:100%;">';
                } else {
                    html += '<p>' + text + '</p>';
                }
            });
            return '<div class="admin-preview-text">' + html + '</div>';
        },
        renderEditor: function(block) {
            return '<div class="mb-2"><button type="button" class="btn btn-sm btn-outline-info" id="editorjs-media-btn"><i class="fas fa-images mr-1"></i> Insert from Media Library</button></div>' +
                '<div id="block-editorjs" style="border:1px solid #ced4da;border-radius:4px;min-height:200px;padding:8px;"></div>';
        },
        initEditor: function(block) {
            initEditorJS(block);
            $('#editorjs-media-btn').off('click').on('click', function() {
                openMediaBrowser(function(media) {
                    if (editorJsInstance) {
                        editorJsInstance.blocks.insert('image', {
                            file: { url: media.url },
                            caption: media.alt || '',
                            withBorder: false,
                            stretched: false,
                            withBackground: false
                        });
                    }
                });
            });
        },
        collectData: function(block) {
            if (editorJsInstance) {
                return editorJsInstance.save().then(function(data) {
                    return { content: data, settings: {} };
                });
            }
            return Promise.resolve({ content: block.content, settings: block.settings });
        }
    });

    PageEditor.registerBlockType('image', {
        icon: 'fa-image',
        label: 'Image',
        defaults: { content: { url: '', alt: '', caption: '' }, settings: { link: '', max_width: '100%' } },
        renderPreview: function(block) {
            var url = block.content && block.content.url ? block.content.url : '';
            if (!url) return '<em>No image set</em>';
            var caption = block.content && block.content.caption ? block.content.caption : '';
            return '<div><img src="' + escHtml(url) + '" style="max-width:100%;max-height:200px;border-radius:4px;">' +
                (caption ? '<div style="font-size:0.85em;color:#555;margin-top:4px;">' + escHtml(caption) + '</div>' : '') + '</div>';
        },
        renderEditor: function(block) {
            var url = block.content && block.content.url ? block.content.url : '';
            var alt = block.content && block.content.alt ? block.content.alt : '';
            var caption = block.content && block.content.caption ? block.content.caption : '';
            var link = block.settings && block.settings.link ? block.settings.link : '';
            var maxWidth = block.settings && block.settings.max_width ? block.settings.max_width : '100%';
            return '<div class="form-group"><label>Image</label>' +
                '<div class="d-flex align-items-stretch mb-2" style="gap:10px;">' +
                    '<div class="flex-grow-1 needsclick block-img-dz" id="block-image-dropzone"></div>' +
                    '<button type="button" class="btn btn-outline-info" id="browse-media-btn" style="white-space:nowrap;"><i class="fas fa-images d-block mb-1" style="font-size:1.2em;"></i> Browse<br>Media</button>' +
                '</div>' +
                '<small class="text-muted">Or enter URL manually:</small>' +
                '<input type="text" class="form-control mt-1" id="img-url" value="' + escHtml(url) + '" placeholder="https://...">' +
                '<div class="mt-2" id="img-preview">' + (url ? '<img src="' + escHtml(url) + '" style="max-height:100px;border-radius:4px;">' : '') + '</div>' +
                '</div>' +
                '<div class="form-group"><label>Alt Text</label><input type="text" class="form-control" id="img-alt" value="' + escHtml(alt) + '"></div>' +
                '<div class="form-group"><label>Caption</label><input type="text" class="form-control" id="img-caption" value="' + escHtml(caption) + '"></div>' +
                '<div class="form-group"><label>Link URL (optional)</label><input type="text" class="form-control" id="img-link" value="' + escHtml(link) + '"></div>' +
                '<div class="form-group"><label>Max Width</label><input type="text" class="form-control" id="img-maxwidth" value="' + escHtml(maxWidth) + '" placeholder="100%"></div>';
        },
        initEditor: function(block) {
            initBlockImageDropzone();
            $('#browse-media-btn').off('click').on('click', function() {
                openMediaBrowser(function(media) {
                    $('#img-url').val(media.url);
                    if (media.alt) $('#img-alt').val(media.alt);
                    $('#img-preview').html('<img src="' + escHtml(media.url) + '" style="max-height:100px;border-radius:4px;">');
                });
            });
        },
        collectData: function(block) {
            return {
                content: {
                    url: $('#img-url').val(),
                    alt: $('#img-alt').val(),
                    caption: $('#img-caption').val()
                },
                settings: {
                    link: $('#img-link').val(),
                    max_width: $('#img-maxwidth').val() || '100%'
                }
            };
        }
    });

    PageEditor.registerBlockType('video', {
        icon: 'fa-video',
        label: 'Video',
        defaults: { content: { url: '' }, settings: { aspect_ratio: '16:9' } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
            var url = block.content && block.content.url ? block.content.url : '';
            return '<div class="form-group"><label>Video URL</label>' +
                '<input type="text" class="form-control" id="video-url" value="' + escHtml(url) + '" placeholder="https://www.youtube.com/watch?v=...">' +
                '<small class="text-muted">Paste a YouTube or Vimeo URL</small></div>' +
                '<div id="video-preview" class="mt-2">' + getVideoPreviewHtml(url) + '</div>';
        },
        initEditor: function(block) {
            // Video URL live preview binding is handled in bindFormEvents
        },
        collectData: function(block) {
            return {
                content: { url: $('#video-url').val() },
                settings: block.settings
            };
        }
    });

    PageEditor.registerBlockType('html', {
        icon: 'fa-code',
        label: 'Custom HTML',
        defaults: { content: { html: '' }, settings: {} },
        renderPreview: function(block) {
            var htmlContent = (block.content && block.content.html) ? block.content.html : '';
            return '<div style="border:1px solid #e9ecef;border-radius:4px;padding:8px;background:#fafafa;">' + htmlContent + '</div>';
        },
        renderEditor: function(block) {
            var html = block.content && block.content.html ? block.content.html : '';
            return '<div class="form-group"><label>Custom HTML</label>' +
                '<div class="alert alert-warning py-1 mb-2"><small><i class="fas fa-exclamation-triangle"></i> This content will be rendered as-is. Use with caution.</small></div>' +
                '<textarea class="form-control" id="html-content" rows="10" style="font-family:monospace;">' + escHtml(html) + '</textarea></div>';
        },
        initEditor: function(block) {},
        collectData: function(block) {
            return {
                content: { html: $('#html-content').val() },
                settings: block.settings
            };
        }
    });

    PageEditor.registerBlockType('accordion', {
        icon: 'fa-list-ul',
        label: 'Accordion Q&A',
        defaults: { content: { items: [] }, settings: { first_open: true } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
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
        },
        initEditor: function(block) {
            initAccordionEditor(block);
        },
        collectData: function(block) {
            var items = [];
            $('#accordion-items-list .accordion-item-row').each(function() {
                items.push({
                    title: $(this).find('.acc-title').val(),
                    body: $(this).find('.acc-body').val()
                });
            });
            return {
                content: { items: items },
                settings: { first_open: $('#accordion-first-open').is(':checked') }
            };
        }
    });

    PageEditor.registerBlockType('contact_form', {
        icon: 'fa-envelope',
        label: 'Contact Form',
        defaults: {
            content: {},
            settings: {
                fields: {
                    name: { enabled: true, required: true },
                    email: { enabled: true, required: true },
                    phone: { enabled: true, required: false },
                    subject: { enabled: true, required: false },
                    message: { enabled: true, required: true }
                },
                submit_label: 'Send Message',
                success_message: 'Thank you for your message!'
            }
        },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
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
        },
        initEditor: function(block) {},
        collectData: function(block) {
            var fieldNames = ['name', 'email', 'phone', 'subject', 'message'];
            var fields = {};
            fieldNames.forEach(function(f) {
                fields[f] = {
                    enabled: $('.cf-enabled[data-field="' + f + '"]').is(':checked'),
                    required: $('.cf-required[data-field="' + f + '"]').is(':checked')
                };
            });
            return {
                content: block.content,
                settings: {
                    fields: fields,
                    submit_label: $('#cf-submit-label').val(),
                    success_message: $('#cf-success-msg').val()
                }
            };
        }
    });

    PageEditor.registerBlockType('carousel', {
        icon: 'fa-images',
        label: 'Carousel Slider',
        defaults: { content: { slides: [] }, settings: { autoplay: true, interval: 5000, show_arrows: true, show_dots: true } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
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
        },
        initEditor: function(block) {
            initCarouselEditor(block);
        },
        collectData: function(block) {
            var slides = [];
            $('#carousel-slides-list .carousel-slide-row').each(function() {
                slides.push({
                    image_url: $(this).find('.slide-image').val(),
                    caption: $(this).find('.slide-caption').val(),
                    link: $(this).find('.slide-link').val()
                });
            });
            return {
                content: { slides: slides },
                settings: {
                    autoplay: $('#carousel-autoplay').is(':checked'),
                    interval: parseInt($('#carousel-interval').val()) || 5000,
                    show_arrows: $('#carousel-arrows').is(':checked'),
                    show_dots: $('#carousel-dots').is(':checked')
                }
            };
        }
    });

    PageEditor.registerBlockType('gallery', {
        icon: 'fa-th',
        label: 'Image Gallery',
        defaults: { content: { images: [] }, settings: { columns: 3, gap: 10, lightbox: true } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
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
        },
        initEditor: function(block) {
            initGalleryEditor(block);
        },
        collectData: function(block) {
            var images = [];
            $('#gallery-images-list .gallery-image-row').each(function() {
                images.push({
                    url: $(this).find('.gal-url').val(),
                    alt: $(this).find('.gal-alt').val(),
                    caption: $(this).find('.gal-caption').val()
                });
            });
            return {
                content: { images: images },
                settings: {
                    columns: parseInt($('#gallery-columns').val()) || 3,
                    gap: parseInt($('#gallery-gap').val()) || 10,
                    lightbox: $('#gallery-lightbox').is(':checked')
                }
            };
        }
    });

    PageEditor.registerBlockType('testimonials', {
        icon: 'fa-quote-right',
        label: 'Testimonials',
        defaults: { content: { testimonials: [] }, settings: { layout: 'cards' } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
            var testimonials = block.content && block.content.testimonials ? block.content.testimonials : [];
            var testiHtml = '';
            testimonials.forEach(function(t, i) {
                testiHtml += buildTestimonialRow(t, i);
            });
            return '<div id="testimonials-list">' + testiHtml + '</div>' +
                '<button type="button" class="btn btn-sm btn-success mt-2" id="add-testimonial">+ Add Testimonial</button>';
        },
        initEditor: function(block) {
            initTestimonialsEditor(block);
        },
        collectData: function(block) {
            var testimonials = [];
            $('#testimonials-list .testi-row').each(function() {
                testimonials.push({
                    quote: $(this).find('.testi-quote').val(),
                    name: $(this).find('.testi-name').val(),
                    title: $(this).find('.testi-title').val(),
                    photo_url: $(this).find('.testi-photo').val()
                });
            });
            return {
                content: { testimonials: testimonials },
                settings: { layout: 'cards' }
            };
        }
    });

    PageEditor.registerBlockType('icon_box', {
        icon: 'fa-icons',
        label: 'Icon Box',
        defaults: { content: { items: [] }, settings: { columns: 3, layout: 'vertical' } },
        renderPreview: function(block) {
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
        },
        renderEditor: function(block) {
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
        },
        initEditor: function(block) {
            initIconBoxEditor(block);
        },
        collectData: function(block) {
            var iconBoxItems = [];
            $('#iconbox-items-list .ib-row').each(function() {
                iconBoxItems.push({
                    icon: $(this).find('.ib-icon').val(),
                    title: $(this).find('.ib-title').val(),
                    description: $(this).find('.ib-desc').val()
                });
            });
            return {
                content: { items: iconBoxItems },
                settings: {
                    columns: parseInt($('#iconbox-columns').val()) || 3,
                    layout: $('#iconbox-layout').val() || 'vertical'
                }
            };
        }
    });

    PageEditor.registerBlockType('categories_grid', {
        icon: 'fa-th-large',
        label: 'Categories Grid',
        defaults: { content: {}, settings: { columns: 3, max_count: 12, show_post_count: true } },
        renderPreview: function(block) {
            var s = block.settings || {};
            var cols = s.columns || 3;
            var max = s.max_count || 12;
            var showCount = s.show_post_count !== false;
            return '<div style="padding:8px;background:#f0f4f8;border-radius:4px;text-align:center;">' +
                '<i class="fas fa-th-large" style="font-size:1.5em;color:#6c757d;"></i>' +
                '<div style="font-size:0.85em;color:#555;margin-top:4px;">Categories Grid &mdash; ' + cols + ' cols, max ' + max +
                (showCount ? ', with count' : '') + '</div></div>';
        },
        renderEditor: function(block) {
            var s = block.settings || {};
            var columns = s.columns || 3;
            var maxCount = s.max_count || 12;
            var showPostCount = s.show_post_count !== false;
            return '<div class="form-group"><label>Columns</label>' +
                '<input type="number" class="form-control" id="catgrid-columns" value="' + columns + '" min="1" max="6"></div>' +
                '<div class="form-group"><label>Max Categories</label>' +
                '<input type="number" class="form-control" id="catgrid-max" value="' + maxCount + '" min="1" max="50"></div>' +
                '<div class="form-check">' +
                    '<input type="checkbox" class="form-check-input" id="catgrid-count"' + (showPostCount ? ' checked' : '') + '>' +
                    '<label class="form-check-label" for="catgrid-count">Show post count</label>' +
                '</div>';
        },
        initEditor: function(block) {},
        collectData: function(block) {
            return {
                content: {},
                settings: {
                    columns: parseInt($('#catgrid-columns').val()) || 3,
                    max_count: parseInt($('#catgrid-max').val()) || 12,
                    show_post_count: $('#catgrid-count').is(':checked')
                }
            };
        }
    });

    PageEditor.registerBlockType('posts_grid', {
        icon: 'fa-newspaper',
        label: 'Posts Grid',
        defaults: { content: {}, settings: { columns: 3, max_count: 12, category_id: '', order_by: 'newest', show_excerpt: true } },
        renderPreview: function(block) {
            var s = block.settings || {};
            var cols = s.columns || 3;
            var max = s.max_count || 12;
            var order = s.order_by || 'newest';
            var catId = s.category_id || 'all';
            return '<div style="padding:8px;background:#f0f4f8;border-radius:4px;text-align:center;">' +
                '<i class="fas fa-newspaper" style="font-size:1.5em;color:#6c757d;"></i>' +
                '<div style="font-size:0.85em;color:#555;margin-top:4px;">Posts Grid &mdash; ' + cols + ' cols, max ' + max +
                ', ' + order + ', cat: ' + catId + '</div></div>';
        },
        renderEditor: function(block) {
            var s = block.settings || {};
            var columns = s.columns || 3;
            var maxCount = s.max_count || 12;
            var categoryId = s.category_id || '';
            var orderBy = s.order_by || 'newest';
            var showExcerpt = s.show_excerpt !== false;
            var catOptions = '<option value="">All categories</option>';
            if (window.PageEditorConfig && window.PageEditorConfig.categories) {
                window.PageEditorConfig.categories.forEach(function(cat) {
                    catOptions += '<option value="' + cat.id + '"' + (String(categoryId) === String(cat.id) ? ' selected' : '') + '>' + escHtml(cat.name) + '</option>';
                });
            }
            return '<div class="form-group"><label>Columns</label>' +
                '<input type="number" class="form-control" id="postgrid-columns" value="' + columns + '" min="1" max="6"></div>' +
                '<div class="form-group"><label>Max Posts</label>' +
                '<input type="number" class="form-control" id="postgrid-max" value="' + maxCount + '" min="1" max="50"></div>' +
                '<div class="form-group"><label>Category Filter</label>' +
                '<select class="form-control" id="postgrid-category">' + catOptions + '</select></div>' +
                '<div class="form-group"><label>Order By</label>' +
                '<select class="form-control" id="postgrid-order">' +
                    '<option value="newest"' + (orderBy === 'newest' ? ' selected' : '') + '>Newest first</option>' +
                    '<option value="oldest"' + (orderBy === 'oldest' ? ' selected' : '') + '>Oldest first</option>' +
                    '<option value="title_asc"' + (orderBy === 'title_asc' ? ' selected' : '') + '>Title A-Z</option>' +
                    '<option value="title_desc"' + (orderBy === 'title_desc' ? ' selected' : '') + '>Title Z-A</option>' +
                '</select></div>' +
                '<div class="form-check">' +
                    '<input type="checkbox" class="form-check-input" id="postgrid-excerpt"' + (showExcerpt ? ' checked' : '') + '>' +
                    '<label class="form-check-label" for="postgrid-excerpt">Show excerpt</label>' +
                '</div>';
        },
        initEditor: function(block) {},
        collectData: function(block) {
            return {
                content: {},
                settings: {
                    columns: parseInt($('#postgrid-columns').val()) || 3,
                    max_count: parseInt($('#postgrid-max').val()) || 12,
                    category_id: $('#postgrid-category').val() || '',
                    order_by: $('#postgrid-order').val() || 'newest',
                    show_excerpt: $('#postgrid-excerpt').is(':checked')
                }
            };
        }
    });

    PageEditor.registerBlockType('hero', {
        icon: 'fa-flag',
        label: 'Hero Banner',
        defaults: {
            content: { title: '', subtitle: '', primary_button_text: '', primary_button_url: '', secondary_button_text: '', secondary_button_url: '' },
            settings: { background_overlay: 'rgba(0,0,0,0.4)', text_alignment: 'center', min_height: '80vh' }
        },
        renderPreview: function(block) {
            var c = block.content || {};
            var s = block.settings || {};
            var title = c.title || 'Hero Banner';
            var subtitle = c.subtitle || '';
            var overlay = s.background_overlay || 'rgba(0,0,0,0.4)';
            return '<div style="position:relative;padding:24px 16px;background:linear-gradient(135deg,#1e3a5f,#2d5f8a);color:#fff;border-radius:6px;text-align:' + (s.text_alignment || 'center') + ';">' +
                '<div style="position:relative;z-index:1;">' +
                '<div style="font-size:1.3em;font-weight:700;margin-bottom:6px;">' + escHtml(title) + '</div>' +
                (subtitle ? '<div style="font-size:0.9em;opacity:0.85;">' + escHtml(subtitle) + '</div>' : '') +
                '</div></div>';
        },
        renderEditor: function(block) {
            var c = block.content || {};
            var s = block.settings || {};
            return '<div class="form-group"><label>Title</label><input type="text" class="form-control" id="hero-title" value="' + escHtml(c.title || '') + '"></div>' +
                '<div class="form-group"><label>Subtitle</label><textarea class="form-control" id="hero-subtitle" rows="2">' + escHtml(c.subtitle || '') + '</textarea></div>' +
                '<hr><strong>Buttons</strong>' +
                '<div class="form-row mt-2"><div class="form-group col-md-6"><label>Primary Button Text</label><input type="text" class="form-control" id="hero-btn1-text" value="' + escHtml(c.primary_button_text || '') + '"></div>' +
                '<div class="form-group col-md-6"><label>Primary Button URL</label><input type="text" class="form-control" id="hero-btn1-url" value="' + escHtml(c.primary_button_url || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group col-md-6"><label>Secondary Button Text</label><input type="text" class="form-control" id="hero-btn2-text" value="' + escHtml(c.secondary_button_text || '') + '"></div>' +
                '<div class="form-group col-md-6"><label>Secondary Button URL</label><input type="text" class="form-control" id="hero-btn2-url" value="' + escHtml(c.secondary_button_url || '') + '"></div></div>' +
                '<hr><strong>Settings</strong>' +
                '<div class="form-row mt-2"><div class="form-group col-md-4"><label>Overlay Color</label><input type="text" class="form-control" id="hero-overlay" value="' + escHtml(s.background_overlay || 'rgba(0,0,0,0.4)') + '" placeholder="rgba(0,0,0,0.4)"></div>' +
                '<div class="form-group col-md-4"><label>Text Alignment</label><select class="form-control" id="hero-align">' +
                    '<option value="left"' + (s.text_alignment === 'left' ? ' selected' : '') + '>Left</option>' +
                    '<option value="center"' + (s.text_alignment !== 'left' && s.text_alignment !== 'right' ? ' selected' : '') + '>Center</option>' +
                    '<option value="right"' + (s.text_alignment === 'right' ? ' selected' : '') + '>Right</option></select></div>' +
                '<div class="form-group col-md-4"><label>Min Height</label><input type="text" class="form-control" id="hero-height" value="' + escHtml(s.min_height || '80vh') + '" placeholder="80vh"></div></div>';
        },
        initEditor: function(block) {},
        collectData: function(block) {
            return {
                content: {
                    title: $('#hero-title').val(),
                    subtitle: $('#hero-subtitle').val(),
                    primary_button_text: $('#hero-btn1-text').val(),
                    primary_button_url: $('#hero-btn1-url').val(),
                    secondary_button_text: $('#hero-btn2-text').val(),
                    secondary_button_url: $('#hero-btn2-url').val()
                },
                settings: {
                    background_overlay: $('#hero-overlay').val() || 'rgba(0,0,0,0.4)',
                    text_alignment: $('#hero-align').val() || 'center',
                    min_height: $('#hero-height').val() || '80vh'
                }
            };
        }
    });

    PageEditor.registerBlockType('cta', {
        icon: 'fa-bullhorn',
        label: 'Call to Action',
        defaults: {
            content: { heading: '', description: '', primary_button_text: '', primary_button_url: '', secondary_button_text: '', secondary_button_url: '' },
            settings: { text_alignment: 'center' }
        },
        renderPreview: function(block) {
            var c = block.content || {};
            var heading = c.heading || 'Call to Action';
            var desc = c.description || '';
            return '<div style="padding:16px;background:#f0f4f8;border-radius:6px;text-align:' + ((block.settings || {}).text_alignment || 'center') + ';">' +
                '<div style="font-size:1.2em;font-weight:700;margin-bottom:4px;">' + escHtml(heading) + '</div>' +
                (desc ? '<div style="font-size:0.85em;color:#555;">' + escHtml(desc.length > 100 ? desc.substring(0, 100) + '...' : desc) + '</div>' : '') +
                '</div>';
        },
        renderEditor: function(block) {
            var c = block.content || {};
            var s = block.settings || {};
            return '<div class="form-group"><label>Heading</label><input type="text" class="form-control" id="cta-heading" value="' + escHtml(c.heading || '') + '"></div>' +
                '<div class="form-group"><label>Description</label><textarea class="form-control" id="cta-description" rows="2">' + escHtml(c.description || '') + '</textarea></div>' +
                '<hr><strong>Buttons</strong>' +
                '<div class="form-row mt-2"><div class="form-group col-md-6"><label>Primary Button Text</label><input type="text" class="form-control" id="cta-btn1-text" value="' + escHtml(c.primary_button_text || '') + '"></div>' +
                '<div class="form-group col-md-6"><label>Primary Button URL</label><input type="text" class="form-control" id="cta-btn1-url" value="' + escHtml(c.primary_button_url || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group col-md-6"><label>Secondary Button Text</label><input type="text" class="form-control" id="cta-btn2-text" value="' + escHtml(c.secondary_button_text || '') + '"></div>' +
                '<div class="form-group col-md-6"><label>Secondary Button URL</label><input type="text" class="form-control" id="cta-btn2-url" value="' + escHtml(c.secondary_button_url || '') + '"></div></div>' +
                '<hr>' +
                '<div class="form-group"><label>Text Alignment</label><select class="form-control" id="cta-align">' +
                    '<option value="left"' + (s.text_alignment === 'left' ? ' selected' : '') + '>Left</option>' +
                    '<option value="center"' + (s.text_alignment !== 'left' && s.text_alignment !== 'right' ? ' selected' : '') + '>Center</option>' +
                    '<option value="right"' + (s.text_alignment === 'right' ? ' selected' : '') + '>Right</option></select></div>';
        },
        initEditor: function(block) {},
        collectData: function(block) {
            return {
                content: {
                    heading: $('#cta-heading').val(),
                    description: $('#cta-description').val(),
                    primary_button_text: $('#cta-btn1-text').val(),
                    primary_button_url: $('#cta-btn1-url').val(),
                    secondary_button_text: $('#cta-btn2-text').val(),
                    secondary_button_url: $('#cta-btn2-url').val()
                },
                settings: {
                    text_alignment: $('#cta-align').val() || 'center'
                }
            };
        }
    });

    // =========================================================================
    // Core editor functions (use registry)
    // =========================================================================

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
                    background_color: b.background_color || '',
                    background_image: b.background_image || '',
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
                background_color: row.background_color || '',
                background_image: row.background_image || '',
                order: row.order_column || 0,
                columns: columns
            };
        });
    }

    // --- Row Management ---
    function addRow() {
        var newRow = { id: uid(), name: '', css_class: '', background_color: '', background_image: '', order: rows.length, columns: [{ width: 12, blocks: [] }] };
        rows.push(newRow);
        renderRows();
        initRowSortable();
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

        var bgIndicator = '';
        if (row.background_color || row.background_image) {
            var bgParts = [];
            if (row.background_color) bgParts.push('<span class="row-bg-swatch" style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #ccc;vertical-align:middle;background:' + escHtml(row.background_color) + ';"></span>');
            if (row.background_image) bgParts.push('<i class="fas fa-image" style="font-size:0.8em;color:#6c757d;vertical-align:middle;"></i>');
            bgIndicator = '<span class="ml-2" title="Background set">' + bgParts.join(' ') + '</span>';
        }

        return '<div class="card mb-3 page-row-editor" data-row-id="' + row.id + '">' +
            '<div class="card-header d-flex justify-content-between align-items-center">' +
                '<div class="d-flex align-items-center">' +
                    '<span class="drag-handle mr-2"><i class="fas fa-grip-vertical"></i></span>' +
                    '<input type="text" class="form-control form-control-sm row-name-input" placeholder="Row name (optional)" value="' + escHtml(row.name) + '" style="width:200px;" data-row-id="' + row.id + '">' +
                    bgIndicator +
                '</div>' +
                '<div>' +
                    '<button type="button" class="btn btn-sm btn-outline-info row-bg-btn mr-1" data-row-id="' + row.id + '" title="Row Background"><i class="fas fa-paint-roller"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary column-layout-btn mr-1" data-row-id="' + row.id + '" title="Column Layout"><i class="fas fa-columns"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-danger remove-row-btn" data-row-id="' + row.id + '" title="Remove Row"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="card-body py-2">' +
                '<div class="row">' + colsHtml + '</div>' +
            '</div>' +
        '</div>';
    }

    function buildBlockHtml(block, ci, bi) {
        var config = PageEditor.blockTypes[block.type];
        var icon = config ? config.icon : 'fa-cube';
        var label = config ? config.label : block.type;
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
        var config = PageEditor.blockTypes[block.type];
        if (config && config.renderPreview) {
            return config.renderPreview(block);
        }
        return '';
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

    // --- Edit Modal (uses registry) ---
    function openEditModal(rowId, colIndex, blockIndex) {
        var row = getRow(rowId);
        if (!row) return;
        var block = row.columns[colIndex].blocks[blockIndex];
        if (!block) return;
        editingRowId = rowId;
        editingColIndex = colIndex;
        editingBlockIndex = blockIndex;

        var config = PageEditor.blockTypes[block.type];
        var html = config ? config.renderEditor(block) : '<em>Unknown block type: ' + escHtml(block.type) + '</em>';

        // Block background fields
        html += '<hr><details class="mt-2"><summary style="cursor:pointer;font-weight:500;font-size:0.9em;"><i class="fas fa-paint-roller mr-1"></i> Block Background</summary><div class="mt-2">' +
            '<div class="form-group"><label>Background Color</label>' +
            '<div class="input-group"><input type="color" class="form-control form-control-color" id="block-bg-color" value="' + escHtml(block.background_color || '#ffffff') + '" style="width:60px;padding:2px;">' +
            '<input type="text" class="form-control" id="block-bg-color-text" value="' + escHtml(block.background_color || '') + '" placeholder="#hex or empty for none">' +
            '<div class="input-group-append"><button type="button" class="btn btn-outline-secondary" id="block-bg-color-clear" title="Clear"><i class="fas fa-times"></i></button></div></div></div>' +
            '<div class="form-group"><label>Background Image URL</label>' +
            '<input type="text" class="form-control" id="block-bg-image" value="' + escHtml(block.background_image || '') + '" placeholder="https://...">' +
            '</div></div></details>';

        $('.modal-title').text('Edit Block: ' + (config ? config.label : block.type));
        $('#block-edit-content').html(html);
        if (config && config.initEditor) { config.initEditor(block); }

        // Block background color sync
        $('#block-bg-color').on('input', function() { $('#block-bg-color-text').val($(this).val()); });
        $('#block-bg-color-text').on('input', function() { var v = $(this).val(); if (/^#[0-9a-fA-F]{6}$/.test(v)) $('#block-bg-color').val(v); });
        $('#block-bg-color-clear').on('click', function() { $('#block-bg-color-text').val(''); });

        $('#block-edit-modal').modal('show');
    }

    // --- Save Block (uses registry) ---
    function saveBlock() {
        var row = getRow(editingRowId);
        if (!row) return;

        // Row background mode
        if (editingColIndex === null && editingBlockIndex === null) {
            row.background_color = $('#row-bg-color-text').val() || '';
            row.background_image = $('#row-bg-image').val() || '';
            finalizeSave();
            return;
        }

        var block = row.columns[editingColIndex].blocks[editingBlockIndex];
        if (!block) return;

        // Collect block background fields
        block.background_color = $('#block-bg-color-text').val() || '';
        block.background_image = $('#block-bg-image').val() || '';

        var config = PageEditor.blockTypes[block.type];
        if (!config) { finalizeSave(); return; }

        var result = config.collectData(block);
        if (result && typeof result.then === 'function') {
            result.then(function(data) {
                if (data && data.content !== undefined) block.content = data.content;
                if (data && data.settings !== undefined) block.settings = data.settings;
                finalizeSave();
            });
        } else {
            if (result && result.content !== undefined) block.content = result.content;
            if (result && result.settings !== undefined) block.settings = result.settings;
            finalizeSave();
        }
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
                        settings: block.settings,
                        background_color: block.background_color || '',
                        background_image: block.background_image || ''
                    });
                });
            });
            return {
                id: row.id,
                name: row.name,
                css_class: row.css_class,
                background_color: row.background_color || '',
                background_image: row.background_image || '',
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

        // Block events — "Add Block" picker built dynamically from registry
        $(document).on('click', '.add-block-btn', function() {
            var rowId = $(this).data('row-id');
            var colIndex = parseInt($(this).data('col-index'));
            var buttonsHtml = '';
            Object.keys(PageEditor.blockTypes).forEach(function(type) {
                var cfg = PageEditor.blockTypes[type];
                buttonsHtml += '<button class="btn btn-outline-secondary block-type-btn" data-type="' + escHtml(type) + '">' +
                    '<i class="fas ' + escHtml(cfg.icon) + ' mr-1"></i>' + escHtml(cfg.label) + '</button>';
            });
            var html = '<div class="block-type-picker">' +
                '<p class="mb-2"><strong>Choose a block type:</strong></p>' +
                '<div class="d-flex flex-wrap" style="gap:8px;">' + buttonsHtml + '</div></div>';
            $('#block-edit-content').html(html);
            $('#block-edit-modal .modal-title').text('Add Block');
            $('#save-block-btn').hide();
            $(document).off('click.blocktype').on('click.blocktype', '.block-type-btn', function() {
                var type = $(this).data('type');
                $(document).off('click.blocktype');
                var row = getRow(rowId);
                if (!row) return;
                var cfg = PageEditor.blockTypes[type];
                if (!cfg) return;
                var defaults = cfg.defaults || { content: {}, settings: {} };
                var block = {
                    id: uid(),
                    type: type,
                    content: JSON.parse(JSON.stringify(defaults.content || {})),
                    settings: JSON.parse(JSON.stringify(defaults.settings || {})),
                    background_color: '',
                    background_image: '',
                    order: row.columns[colIndex].blocks.length
                };
                row.columns[colIndex].blocks.push(block);
                renderRows();
                initRowSortable();
                // Swap modal content to the edit form without closing/reopening
                var bi = row.columns[colIndex].blocks.length - 1;
                editingRowId = rowId;
                editingColIndex = colIndex;
                editingBlockIndex = bi;
                var editHtml = cfg.renderEditor(block);
                $('.modal-title').text('Edit Block: ' + cfg.label);
                $('#block-edit-content').html(editHtml);
                $('#save-block-btn').show();
                if (cfg.initEditor) { cfg.initEditor(block); }
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

        // Row background settings
        $(document).on('click', '.row-bg-btn', function() {
            var rowId = $(this).data('row-id');
            var row = getRow(rowId);
            if (!row) return;
            var html = '<div class="form-group"><label>Background Color</label>' +
                '<div class="input-group"><input type="color" class="form-control form-control-color" id="row-bg-color" value="' + escHtml(row.background_color || '#ffffff') + '" style="width:60px;padding:2px;">' +
                '<input type="text" class="form-control" id="row-bg-color-text" value="' + escHtml(row.background_color || '') + '" placeholder="#hex or empty for none">' +
                '<div class="input-group-append"><button type="button" class="btn btn-outline-secondary" id="row-bg-color-clear" title="Clear"><i class="fas fa-times"></i></button></div></div></div>' +
                '<div class="form-group"><label>Background Image URL</label>' +
                '<input type="text" class="form-control" id="row-bg-image" value="' + escHtml(row.background_image || '') + '" placeholder="https://...">' +
                (row.background_image ? '<div class="mt-2"><img src="' + escHtml(row.background_image) + '" style="max-height:80px;border-radius:4px;"></div>' : '') +
                '</div>';
            $('#block-edit-content').html(html);
            $('#block-edit-modal .modal-title').text('Row Background');
            editingRowId = rowId;
            editingColIndex = null;
            editingBlockIndex = null;
            $('#save-block-btn').show();
            $('#row-bg-color').on('input', function() { $('#row-bg-color-text').val($(this).val()); });
            $('#row-bg-color-text').on('input', function() { var v = $(this).val(); if (/^#[0-9a-fA-F]{6}$/.test(v)) $('#row-bg-color').val(v); });
            $('#row-bg-color-clear').on('click', function() { $('#row-bg-color-text').val(''); });
            $('#block-edit-modal').modal('show');
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

        // --- Media Browser event handlers ---
        $(document).on('click', '.media-browser-item', function() {
            var url = $(this).data('url');
            var alt = $(this).data('alt') || '';
            if (_mediaBrowserCallback) {
                _mediaBrowserCallback({ url: url, alt: alt });
            }
            $('#media-browser-modal').modal('hide');
        });

        $(document).on('click', '.browse-media-field', function() {
            var $input = $(this).closest('.input-group').find('input[type="text"]');
            var $row = $(this).closest('.gallery-image-row, .carousel-slide-row, .testi-row');
            openMediaBrowser(function(media) {
                $input.val(media.url);
                if (media.alt && $row.length) {
                    var $alt = $row.find('.gal-alt');
                    if ($alt.length && !$alt.val()) $alt.val(media.alt);
                }
            });
        });

        $('#media-browser-modal').on('shown.bs.modal', function() {
            $('.modal-backdrop').last().css('z-index', 1065);
        }).on('hidden.bs.modal', function() {
            if ($('#block-edit-modal').hasClass('show')) {
                $('body').addClass('modal-open');
            }
        });

        var _browserScrollEl = document.getElementById('media-browser-scroll');
        if (_browserScrollEl) {
            _browserScrollEl.addEventListener('scroll', function() {
                if (this.scrollTop + this.clientHeight >= this.scrollHeight - 200) {
                    loadMediaBrowserPage();
                }
            });
        }

        $('#media-browser-upload-btn').on('click', function() {
            $('#media-browser-file').click();
        });

        $('#media-browser-file').on('change', function() {
            var file = this.files[0];
            if (!file) return;
            var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
            var formData = new FormData();
            formData.append('file', file);
            formData.append('size', 20);
            formData.append('width', 4096);
            formData.append('height', 4096);
            $('#media-browser-upload-btn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');
            fetch(getMediaUploadUrl(), {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrf },
                body: formData
            }).then(function(r) { return r.json(); }).then(function(resp) {
                return fetch(getMediaUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
                    body: JSON.stringify({ media_file: resp.name, title: file.name })
                });
            }).then(function(r) { return r.json(); }).then(function(data) {
                $('#media-browser-upload-btn').prop('disabled', false).html('<i class="fas fa-upload mr-1"></i> Upload');
                $('#media-browser-file').val('');
                if (data.success && data.url) {
                    if (_mediaBrowserCallback) {
                        _mediaBrowserCallback({ url: data.url, alt: '' });
                    }
                    $('#media-browser-modal').modal('hide');
                }
            }).catch(function() {
                $('#media-browser-upload-btn').prop('disabled', false).html('<i class="fas fa-upload mr-1"></i> Upload');
                $('#media-browser-file').val('');
            });
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
    window.PageEditor.init = init;

})(jQuery);
